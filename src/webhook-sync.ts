import type { WebhookSyncResult } from './types';

const GITHUB_API = 'https://api.github.com';
const MAX_PAGES = 50;
const CONCURRENCY = 5;

interface GitHubRepo {
  full_name: string;
  archived: boolean;
}

interface GitHubHook {
  id: number;
  config: { url: string };
}

export interface SyncConfig {
  token: string;
  webhookUrl: string;
  webhookSecret: string;
}

export class GitHubRateLimitError extends Error {
  override readonly name = 'GitHubRateLimitError';
  constructor(public readonly retryAfter: string | null) {
    super('GitHub API rate limit exceeded');
  }
}

function throwIfRateLimited(response: { status: number; headers: { get(name: string): string | null } }): void {
  if (response.status === 429 ||
      (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')) {
    throw new GitHubRateLimitError(response.headers.get('Retry-After'));
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'holo-ci-bot',
  };
}

/**
 * 全ユーザーリポジトリ取得（ページネーション対応、上限付き）
 */
async function fetchAllUserRepos(
  token: string,
  fetchFn: typeof fetch
): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let url: string | null = `${GITHUB_API}/user/repos?type=owner&per_page=100`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const response = await fetchFn(url, { headers: githubHeaders(token) });
    throwIfRateLimited(response);
    if (!response.ok) {
      throw new Error(`Failed to fetch repos: ${response.status}`);
    }
    const data: GitHubRepo[] = await response.json();
    repos.push(...data);

    const link = response.headers.get('link');
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    page++;
  }

  return repos;
}

/**
 * リポジトリの既存Webhook一覧からマッチするものを探す
 */
async function findMatchingHook(
  repo: string,
  webhookUrl: string,
  token: string,
  fetchFn: typeof fetch
): Promise<GitHubHook | null> {
  const response = await fetchFn(
    `${GITHUB_API}/repos/${repo}/hooks`,
    { headers: githubHeaders(token) }
  );
  throwIfRateLimited(response);
  if (!response.ok) {
    throw new Error(`Failed to list hooks: ${response.status}`);
  }
  const hooks: GitHubHook[] = await response.json();
  return hooks.find((h) => h.config.url === webhookUrl) ?? null;
}

/**
 * Webhookが未登録なら作成
 */
async function ensureWebhookExists(
  repo: string,
  config: SyncConfig,
  fetchFn: typeof fetch
): Promise<'created' | 'unchanged'> {
  const existing = await findMatchingHook(repo, config.webhookUrl, config.token, fetchFn);
  if (existing) {
    return 'unchanged';
  }

  const response = await fetchFn(
    `${GITHUB_API}/repos/${repo}/hooks`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(config.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['workflow_run'],
        config: {
          url: config.webhookUrl,
          content_type: 'json',
          secret: config.webhookSecret,
        },
      }),
    }
  );

  throwIfRateLimited(response);
  if (!response.ok) {
    throw new Error(`Failed to create hook: ${response.status} ${response.statusText}`);
  }

  return 'created';
}

/**
 * アーカイブ済みリポのWebhookを削除
 */
async function removeWebhookIfExists(
  repo: string,
  config: SyncConfig,
  fetchFn: typeof fetch
): Promise<boolean> {
  const hook = await findMatchingHook(repo, config.webhookUrl, config.token, fetchFn);
  if (!hook) {
    return false;
  }

  const response = await fetchFn(
    `${GITHUB_API}/repos/${repo}/hooks/${hook.id}`,
    {
      method: 'DELETE',
      headers: githubHeaders(config.token),
    }
  );

  throwIfRateLimited(response);
  if (!response.ok) {
    throw new Error(`Failed to delete hook: ${response.status}`);
  }

  return true;
}

/**
 * 並列度制限付きでPromiseを実行
 *
 * abort意味論: fnが例外を投げると残りキューを破棄し早期終了する。
 * 他workerで処理中のアイテムは完了まで走る（キャンセル不可）。
 * 複数workerが同時に例外を投げた場合、最後のエラーのみ保持される。
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  let abortError: Error | null = null;

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0 && !abortError) {
        const item = queue.shift()!;
        try {
          await fn(item);
        } catch (error) {
          abortError = error as Error;
          queue.length = 0;
          return;
        }
      }
    }
  );

  await Promise.all(workers);
  if (abortError) throw abortError;
}

/**
 * 全リポジトリのWebhookを同期
 */
export async function syncWebhooks(
  config: SyncConfig,
  fetchFn: typeof fetch = fetch
): Promise<WebhookSyncResult> {
  const result: WebhookSyncResult = {
    created: [],
    deleted: [],
    unchanged: [],
    errors: [],
  };

  const repos = await fetchAllUserRepos(config.token, fetchFn);

  try {
    await runWithConcurrency(repos, CONCURRENCY, async (repo) => {
      try {
        if (repo.archived) {
          const removed = await removeWebhookIfExists(repo.full_name, config, fetchFn);
          if (removed) {
            result.deleted.push(repo.full_name);
          }
        } else {
          const status = await ensureWebhookExists(repo.full_name, config, fetchFn);
          if (status === 'created') {
            result.created.push(repo.full_name);
          } else {
            result.unchanged.push(repo.full_name);
          }
        }
      } catch (error) {
        if (error instanceof GitHubRateLimitError) throw error;
        result.errors.push({
          repo: repo.full_name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      result.errors.push({ repo: '(rate-limited)', error: error.message });
    } else {
      throw error;
    }
  }

  return result;
}
