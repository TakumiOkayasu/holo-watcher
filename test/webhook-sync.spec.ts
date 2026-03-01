import { describe, it, expect, vi } from 'vitest';
import { syncWebhooks, type SyncConfig } from '../src/webhook-sync';

describe('syncWebhooks', () => {
  const WEBHOOK_URL = 'https://workers.example.com/webhook';

  const createConfig = (overrides?: Partial<SyncConfig>): SyncConfig => ({
    token: 'ghp_test_token',
    webhookUrl: WEBHOOK_URL,
    webhookSecret: 'test-secret',
    ...overrides,
  });

  const reposResponse = (
    repos: Array<{ full_name: string; archived?: boolean }>,
    hasNext = false
  ) => ({
    ok: true,
    status: 200,
    json: async () => repos.map((r) => ({ full_name: r.full_name, archived: r.archived ?? false })),
    headers: new Headers(
      hasNext
        ? { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }
        : {}
    ),
  });

  const hooksResponse = (hooks: Array<{ id: number; config: { url: string } }>) => ({
    ok: true,
    status: 200,
    json: async () => hooks,
    headers: new Headers(),
  });

  const okResponse = () => ({
    ok: true,
    status: 201,
    json: async () => ({}),
    headers: new Headers(),
  });

  const deleteResponse = () => ({
    ok: true,
    status: 204,
    json: async () => ({}),
    headers: new Headers(),
  });

  /**
   * URLパターンでレスポンスを返すmock fetch生成
   */
  const createRoutedFetch = (routes: Array<{ match: (url: string, init?: any) => boolean; response: () => any }>) => {
    return vi.fn((url: string, init?: any) => {
      for (const route of routes) {
        if (route.match(url, init)) {
          return Promise.resolve(route.response());
        }
      }
      return Promise.reject(new Error(`Unmatched URL: ${url}`));
    });
  };

  it('should create webhooks for repos without existing hooks', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/new-repo' }]) },
      { match: (url, init) => url.includes('/repos/owner/new-repo/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/new-repo/hooks') && init?.method === 'POST', response: okResponse },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.created).toEqual(['owner/new-repo']);
    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should skip repos with existing matching webhook', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/existing-repo' }]) },
      { match: (url, init) => url.includes('/repos/owner/existing-repo/hooks') && !init?.method, response: () => hooksResponse([{ id: 1, config: { url: WEBHOOK_URL } }]) },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.unchanged).toEqual(['owner/existing-repo']);
    expect(result.created).toEqual([]);
  });

  it('should delete webhooks from archived repos', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/archived-repo', archived: true }]) },
      { match: (url, init) => url.includes('/repos/owner/archived-repo/hooks') && !init?.method, response: () => hooksResponse([{ id: 42, config: { url: WEBHOOK_URL } }]) },
      { match: (url, init) => url.includes('/hooks/42') && init?.method === 'DELETE', response: deleteResponse },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.deleted).toEqual(['owner/archived-repo']);
    expect(result.created).toEqual([]);
  });

  it('should skip archived repos with no matching webhook', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/archived-no-hook', archived: true }]) },
      { match: (url, init) => url.includes('/repos/owner/archived-no-hook/hooks') && !init?.method, response: () => hooksResponse([]) },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('should handle pagination', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos') && !url.includes('page=2'), response: () => reposResponse([{ full_name: 'owner/repo-1' }], true) },
      { match: (url) => url.includes('/user/repos') && url.includes('page=2'), response: () => reposResponse([{ full_name: 'owner/repo-2' }]) },
      { match: (url, init) => url.includes('/repos/owner/repo-1/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/repo-1/hooks') && init?.method === 'POST', response: okResponse },
      { match: (url, init) => url.includes('/repos/owner/repo-2/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/repo-2/hooks') && init?.method === 'POST', response: okResponse },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.created).toContain('owner/repo-1');
    expect(result.created).toContain('owner/repo-2');
    expect(result.created).toHaveLength(2);
  });

  it('should record errors for failed API calls', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/error-repo' }]) },
      { match: (url, init) => url.includes('/repos/owner/error-repo/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/error-repo/hooks') && init?.method === 'POST', response: () => ({ ok: false, status: 422, statusText: 'Unprocessable Entity', headers: new Headers() }) },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].repo).toBe('owner/error-repo');
    expect(result.created).toEqual([]);
  });

  it('should handle mixed repos (new, existing, archived)', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([
        { full_name: 'owner/new-repo' },
        { full_name: 'owner/existing-repo' },
        { full_name: 'owner/archived-repo', archived: true },
      ]) },
      // new-repo: no hooks → create
      { match: (url, init) => url.includes('/repos/owner/new-repo/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/new-repo/hooks') && init?.method === 'POST', response: okResponse },
      // existing-repo: has matching hook
      { match: (url, init) => url.includes('/repos/owner/existing-repo/hooks') && !init?.method, response: () => hooksResponse([{ id: 1, config: { url: WEBHOOK_URL } }]) },
      // archived-repo: has matching hook → delete
      { match: (url, init) => url.includes('/repos/owner/archived-repo/hooks') && !init?.method, response: () => hooksResponse([{ id: 2, config: { url: WEBHOOK_URL } }]) },
      { match: (url, init) => url.includes('/hooks/2') && init?.method === 'DELETE', response: deleteResponse },
    ]);

    const result = await syncWebhooks(createConfig(), mockFetch);

    expect(result.created).toContain('owner/new-repo');
    expect(result.unchanged).toContain('owner/existing-repo');
    expect(result.deleted).toContain('owner/archived-repo');
    expect(result.errors).toEqual([]);
  });

  it('should use correct headers for GitHub API calls', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/repo' }]) },
      { match: (url, init) => url.includes('/repos/owner/repo/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/repo/hooks') && init?.method === 'POST', response: okResponse },
    ]);

    await syncWebhooks(createConfig(), mockFetch);

    expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer ghp_test_token',
      Accept: 'application/vnd.github+json',
    });
  });

  it('should send correct webhook config on creation', async () => {
    const mockFetch = createRoutedFetch([
      { match: (url) => url.includes('/user/repos'), response: () => reposResponse([{ full_name: 'owner/repo' }]) },
      { match: (url, init) => url.includes('/repos/owner/repo/hooks') && !init?.method, response: () => hooksResponse([]) },
      { match: (url, init) => url.includes('/repos/owner/repo/hooks') && init?.method === 'POST', response: okResponse },
    ]);

    await syncWebhooks(createConfig(), mockFetch);

    const createCall = mockFetch.mock.calls.find(
      ([url, init]: [string, any]) => url.includes('/repos/owner/repo/hooks') && init?.method === 'POST'
    );
    const body = JSON.parse(createCall![1].body);
    expect(body).toMatchObject({
      name: 'web',
      active: true,
      events: ['workflow_run'],
      config: {
        url: WEBHOOK_URL,
        content_type: 'json',
        secret: 'test-secret',
      },
    });
  });

  describe('rate limit handling', () => {
    it('should abort on 429 and record rate-limited error', async () => {
      const mockFetch = createRoutedFetch([
        { match: (url) => url.includes('/user/repos'), response: () => reposResponse([
          { full_name: 'owner/repo-1' },
          { full_name: 'owner/repo-2' },
          { full_name: 'owner/repo-3' },
        ]) },
        // repo-1: hooks list returns 429
        { match: (url, init) => url.includes('/repos/owner/repo-1/hooks') && !init?.method, response: () => ({
          ok: false, status: 429, headers: new Headers({ 'Retry-After': '60' }),
        }) },
        // repo-2, repo-3 should not be reached (but provide fallbacks)
        { match: (url, init) => url.includes('/repos/owner/repo-2/hooks') && !init?.method, response: () => hooksResponse([]) },
        { match: (url, init) => url.includes('/repos/owner/repo-3/hooks') && !init?.method, response: () => hooksResponse([]) },
      ]);

      const result = await syncWebhooks(createConfig(), mockFetch);

      expect(result.errors).toContainEqual({ repo: '(rate-limited)', error: 'GitHub API rate limit exceeded' });
      expect(result.created).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it('should abort on 403 with X-RateLimit-Remaining: 0', async () => {
      const mockFetch = createRoutedFetch([
        { match: (url) => url.includes('/user/repos'), response: () => reposResponse([
          { full_name: 'owner/repo-1' },
        ]) },
        { match: (url, init) => url.includes('/repos/owner/repo-1/hooks') && !init?.method, response: () => ({
          ok: false, status: 403, headers: new Headers({ 'X-RateLimit-Remaining': '0' }),
        }) },
      ]);

      const result = await syncWebhooks(createConfig(), mockFetch);

      expect(result.errors).toContainEqual({ repo: '(rate-limited)', error: 'GitHub API rate limit exceeded' });
    });

    it('should throw on 429 during fetchAllUserRepos', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '30' }),
      });

      await expect(syncWebhooks(createConfig(), mockFetch)).rejects.toThrow('GitHub API rate limit exceeded');
    });
  });

  describe('error handling', () => {
    it('should throw when repos API returns 500', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

      await expect(syncWebhooks(createConfig(), mockFetch)).rejects.toThrow('Failed to fetch repos: 500');
    });

    it('should return empty result for empty repository list', async () => {
      const mockFetch = createRoutedFetch([
        { match: (url) => url.includes('/user/repos'), response: () => reposResponse([]) },
      ]);

      const result = await syncWebhooks(createConfig(), mockFetch);

      expect(result.created).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('archived edge cases', () => {
    it('should process repo with archived: false as normal (create webhook)', async () => {
      const mockFetch = createRoutedFetch([
        { match: (url) => url.includes('/user/repos'), response: () => ({
          ok: true, status: 200,
          json: async () => [{ full_name: 'owner/active-repo', archived: false }],
          headers: new Headers(),
        }) },
        { match: (url, init) => url.includes('/repos/owner/active-repo/hooks') && !init?.method, response: () => hooksResponse([]) },
        { match: (url, init) => url.includes('/repos/owner/active-repo/hooks') && init?.method === 'POST', response: okResponse },
      ]);

      const result = await syncWebhooks(createConfig(), mockFetch);

      expect(result.created).toEqual(['owner/active-repo']);
    });

    it('should process repo with undefined archived field as normal (create webhook)', async () => {
      const mockFetch = createRoutedFetch([
        { match: (url) => url.includes('/user/repos'), response: () => ({
          ok: true, status: 200,
          json: async () => [{ full_name: 'owner/no-archived-field' }],
          headers: new Headers(),
        }) },
        { match: (url, init) => url.includes('/repos/owner/no-archived-field/hooks') && !init?.method, response: () => hooksResponse([]) },
        { match: (url, init) => url.includes('/repos/owner/no-archived-field/hooks') && init?.method === 'POST', response: okResponse },
      ]);

      const result = await syncWebhooks(createConfig(), mockFetch);

      expect(result.created).toEqual(['owner/no-archived-field']);
    });
  });
});
