import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('CI Notification Worker', () => {
  const createRequest = (url: string, options?: RequestInit) =>
    new Request(url, options);

  const createExecutionContext = () => ({
    waitUntil: () => {},
    passThroughOnException: () => {},
  });

  const createMockKV = (): KVNamespace => ({
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  }) as unknown as KVNamespace;

  const createEnv = (overrides?: Partial<ReturnType<typeof createEnv>>) => ({
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    ANTHROPIC_API_KEY: 'test-api-key',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test',
    HOLO_HISTORY: createMockKV(),
    ...overrides,
  });

  describe('Health check', () => {
    it('should return 200 for / endpoint', async () => {
      const request = createRequest('http://example.com/');
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toHaveProperty('status', 'ok');
    });

    it('should return 200 for /health endpoint', async () => {
      const request = createRequest('http://example.com/health');
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(200);
    });
  });

  describe('CORS handling', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = createRequest('http://example.com/', { method: 'OPTIONS' });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Routing', () => {
    it('should return 404 for unknown paths', async () => {
      const request = createRequest('http://example.com/unknown');
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(404);
    });

    it('should return 401 for webhook without signature', async () => {
      const request = createRequest('http://example.com/webhook', {
        method: 'POST',
        body: '{}',
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(401);
    });
  });

  describe('Owner validation', () => {
    const createSignedRequest = async (body: string, secret: string) => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return createRequest('http://example.com/webhook', {
        method: 'POST',
        body,
        headers: {
          'X-Hub-Signature-256': `sha256=${hexSignature}`,
        },
      });
    };

    it('should return 403 for unauthorized owner when ALLOWED_OWNER is set', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          conclusion: 'failure',
          name: 'CI',
          head_branch: 'main',
          head_sha: 'abc123',
          head_commit: { message: 'test commit', author: { name: 'test' } },
          html_url: 'https://github.com/unauthorized/repo/actions/runs/1',
        },
        repository: {
          full_name: 'unauthorized/repo',
          owner: { login: 'unauthorized' },
        },
      };
      const body = JSON.stringify(payload);
      const env = createEnv({ ALLOWED_OWNER: 'allowed-user' });
      const request = await createSignedRequest(body, env.GITHUB_WEBHOOK_SECRET);
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toHaveProperty('reason', 'unauthorized owner');
    });

    it('should allow request when owner matches ALLOWED_OWNER', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          conclusion: 'failure',
          name: 'CI',
          head_branch: 'main',
          head_sha: 'abc123',
          head_commit: { message: 'test commit', author: { name: 'test' } },
          html_url: 'https://github.com/allowed-user/repo/actions/runs/1',
        },
        repository: {
          full_name: 'allowed-user/repo',
          owner: { login: 'allowed-user' },
        },
      };
      const body = JSON.stringify(payload);
      const env = createEnv({ ALLOWED_OWNER: 'allowed-user' });
      const request = await createSignedRequest(body, env.GITHUB_WEBHOOK_SECRET);
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      // Should not be 403 (owner is allowed)
      expect(response.status).not.toBe(403);
    });

    it('should allow any owner when ALLOWED_OWNER is not set', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          conclusion: 'failure',
          name: 'CI',
          head_branch: 'main',
          head_sha: 'abc123',
          head_commit: { message: 'test commit', author: { name: 'test' } },
          html_url: 'https://github.com/any-user/repo/actions/runs/1',
        },
        repository: {
          full_name: 'any-user/repo',
          owner: { login: 'any-user' },
        },
      };
      const body = JSON.stringify(payload);
      const env = createEnv(); // No ALLOWED_OWNER
      const request = await createSignedRequest(body, env.GITHUB_WEBHOOK_SECRET);
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      // Should not be 403 (no owner restriction)
      expect(response.status).not.toBe(403);
    });
  });
});
