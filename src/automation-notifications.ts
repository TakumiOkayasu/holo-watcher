/** Notifications that complement, rather than replace, GitHub's personal inbox. */
export interface AutomationNotice {
  kind: 'pull_request' | 'issues';
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
}

export interface NotificationStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function loginIn(list: unknown, login: string): boolean {
  // Missing or malformed recipients are not evidence that the user is absent.
  if (!Array.isArray(list)) return true;
  return list.some(value => {
    const name = record(value)?.login;
    return typeof name !== 'string' || name.toLowerCase() === login;
  });
}

/** Null means no extra notification; this function has no I/O or model calls. */
export function parseAutomationNotice(
  event: string | null,
  payload: unknown,
  notifyLogin: string | undefined,
): AutomationNotice | null {
  const login = notifyLogin?.trim().toLowerCase();
  if (!login || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) return null;
  if (event !== 'pull_request' && event !== 'issues') return null;
  const data = record(payload);
  const repository = record(data?.repository);
  const item = record(data?.[event === 'pull_request' ? 'pull_request' : 'issue']);
  const user = record(item?.user);
  if (data?.action !== 'opened' || repository?.archived !== false || !item) return null;
  const repo = repository.full_name;
  if (typeof repo !== 'string' || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo)) return null;
  if (event === 'issues' && item.pull_request !== undefined) return null;
  if (user?.type !== 'Bot' || typeof user.login !== 'string' || !user.login) return null;
  if (user.login.toLowerCase() === login || item.state !== 'open') return null;
  if (!Number.isSafeInteger(item.number) || (item.number as number) <= 0) return null;
  if (typeof item.title !== 'string' || !item.title.trim()) return null;
  if (item.body !== null && typeof item.body !== 'string') return null;
  if (loginIn(item.assignees, login)) return null;
  // Team membership is unavailable in a webhook. Suppress conservatively.
  if (event === 'pull_request' && (
    loginIn(item.requested_reviewers, login) ||
    !Array.isArray(item.requested_teams) || item.requested_teams.length > 0
  )) return null;
  const text = `${item.title}\n${item.body ?? ''}`;
  if (new RegExp(`@${login}(?![a-z0-9-])`, 'i').test(text)) return null;
  if (/@[a-z0-9-]+\/[a-z0-9_-]+/i.test(text)) return null;
  const number = item.number as number;
  return {
    kind: event,
    repo,
    number,
    title: item.title,
    author: user.login,
    // Do not forward an arbitrary payload-provided link to Discord.
    url: `https://github.com/${repo}/${event === 'pull_request' ? 'pull' : 'issues'}/${number}`,
  };
}

/** KV deduplication is best-effort, not an atomic exactly-once delivery guarantee. */
export async function deliverAutomationNotice(
  notice: AutomationNotice,
  store: NotificationStore,
  webhookUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | 'duplicate'> {
  const key = `automation:v1:${notice.repo.toLowerCase()}:${notice.kind}:${notice.number}`;
  if (await store.get(key) === 'sent') return 'duplicate';
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  const response = await fetchFn(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      content: '主よ、自動作成されたお知らせじゃ。確認しておくれ。',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: notice.title.slice(0, 256),
        url: notice.url,
        description: `${notice.repo} #${notice.number} (${notice.kind === 'pull_request' ? 'PR' : 'Issue'})`,
        footer: { text: `Created by ${notice.author}` },
      }],
    }),
  });
  if (!response.ok) throw new Error(`Automation notification failed: HTTP ${response.status}`);
  // A failed send must remain eligible for redelivery. Store no issue body or token.
  await store.put(key, 'sent', { expirationTtl: 30 * 24 * 60 * 60 });
  return 'sent';
}
