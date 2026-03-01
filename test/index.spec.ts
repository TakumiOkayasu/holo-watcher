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
    NOTIFY_API_TOKEN: 'test-notify-token',
    ...overrides,
  });

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
    const createOwnerPayload = (owner: string) => ({
      action: 'completed',
      workflow_run: {
        conclusion: 'failure',
        name: 'CI',
        head_branch: 'main',
        head_sha: 'abc123',
        head_commit: { message: 'test commit', author: { name: 'test' } },
        html_url: `https://github.com/${owner}/repo/actions/runs/1`,
      },
      repository: {
        full_name: `${owner}/repo`,
        owner: { login: owner },
      },
    });

    const sendWebhook = async (owner: string, envOverrides?: Partial<ReturnType<typeof createEnv>>) => {
      const body = JSON.stringify(createOwnerPayload(owner));
      const env = createEnv(envOverrides);
      const request = await createSignedRequest(body, env.GITHUB_WEBHOOK_SECRET);
      const ctx = createExecutionContext();
      return worker.fetch(request, env, ctx as ExecutionContext);
    };

    it('should return 403 for unauthorized owner when ALLOWED_OWNER is set', async () => {
      const response = await sendWebhook('unauthorized', { ALLOWED_OWNER: 'allowed-user' });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toHaveProperty('reason', 'unauthorized owner');
    });

    it('should allow request when owner matches ALLOWED_OWNER', async () => {
      const response = await sendWebhook('allowed-user', { ALLOWED_OWNER: 'allowed-user' });

      expect(response.status).not.toBe(403);
    });

    it('should allow owner in comma-separated ALLOWED_OWNER list', async () => {
      const response = await sendWebhook('org-name', { ALLOWED_OWNER: 'allowed-user,org-name' });

      expect(response.status).not.toBe(403);
    });

    it('should handle spaces in comma-separated ALLOWED_OWNER', async () => {
      const response = await sendWebhook('org-name', { ALLOWED_OWNER: ' allowed-user , org-name ' });

      expect(response.status).not.toBe(403);
    });

    it('should return 403 for owner not in comma-separated ALLOWED_OWNER list', async () => {
      const response = await sendWebhook('intruder', { ALLOWED_OWNER: 'allowed-user,org-name' });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toHaveProperty('reason', 'unauthorized owner');
    });

    it('should allow any owner when ALLOWED_OWNER is not set', async () => {
      const response = await sendWebhook('any-user');

      expect(response.status).not.toBe(403);
    });
  });

  describe('/api/notify endpoint', () => {
    const notifyPayload = {
      repo: 'owner/repo',
      workflow: 'CI',
      branch: 'main',
      run_id: '12345',
      run_url: 'https://github.com/owner/repo/actions/runs/12345',
      commit: 'abc123def456789',
      commit_msg: 'fix: some bug',
      author: 'developer',
      error_summary: 'Error: test failed at line 42',
    };

    it('should return 401 without Authorization header', async () => {
      const request = createRequest('http://example.com/api/notify', {
        method: 'POST',
        body: JSON.stringify(notifyPayload),
        headers: { 'Content-Type': 'application/json' },
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(401);
    });

    it('should return 401 with wrong token', async () => {
      const request = createRequest('http://example.com/api/notify', {
        method: 'POST',
        body: JSON.stringify(notifyPayload),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-token',
        },
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid JSON', async () => {
      const request = createRequest('http://example.com/api/notify', {
        method: 'POST',
        body: 'not-json',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-notify-token',
        },
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('message', 'Invalid JSON');
    });

    it('should return 400 for missing required fields', async () => {
      const request = createRequest('http://example.com/api/notify', {
        method: 'POST',
        body: JSON.stringify({ branch: 'main' }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-notify-token',
        },
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('message', 'Missing required fields');
    });

    it('should include Authorization in CORS headers', async () => {
      const request = createRequest('http://example.com/api/notify', { method: 'OPTIONS' });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });
  });

  describe('Archived repository handling', () => {
    it('should ignore webhooks from archived repositories', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          conclusion: 'success',
          name: 'CI',
          head_branch: 'main',
          head_sha: 'abc123',
          head_commit: { message: 'test', author: { name: 'test' } },
          html_url: 'https://github.com/owner/repo/actions/runs/1',
        },
        repository: {
          full_name: 'owner/repo',
          owner: { login: 'owner' },
          archived: true,
        },
      };
      const body = JSON.stringify(payload);
      const env = createEnv();
      const request = await createSignedRequest(body, env.GITHUB_WEBHOOK_SECRET);
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toHaveProperty('reason', 'archived repository');
    });
  });

  describe('/api/sync-webhooks endpoint', () => {
    it('should return 401 without Authorization header', async () => {
      const request = createRequest('http://example.com/api/sync-webhooks', {
        method: 'POST',
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(401);
    });

    it('should return 400 when GITHUB_TOKEN is missing', async () => {
      const request = createRequest('http://example.com/api/sync-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-notify-token' },
      });
      const ctx = createExecutionContext();
      const env = createEnv();
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('message');
    });

    it('should return 400 when WEBHOOK_URL is missing', async () => {
      const request = createRequest('http://example.com/api/sync-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-notify-token' },
      });
      const ctx = createExecutionContext();
      const env = createEnv({ GITHUB_TOKEN: 'ghp_test' });
      const response = await worker.fetch(request, env, ctx as ExecutionContext);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.message).toContain('WEBHOOK_URL');
    });

    it('should return 200 with sync results on success', async () => {
      const WEBHOOK_URL = 'https://example.com/webhook';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/user/repos')) {
          return new Response(JSON.stringify([{ full_name: 'owner/new-repo', archived: false }]), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/repos/owner/new-repo/hooks')) {
          if (init?.method === 'POST') {
            return new Response(JSON.stringify({}), { status: 201 });
          }
          return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      try {
        const request = createRequest('http://example.com/api/sync-webhooks', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-notify-token' },
        });
        const ctx = createExecutionContext();
        const env = createEnv({ GITHUB_TOKEN: 'ghp_test', WEBHOOK_URL });
        const response = await worker.fetch(request, env, ctx as ExecutionContext);

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.status).toBe('success');
        expect(json.created).toEqual(['owner/new-repo']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should return 500 when syncWebhooks throws unexpected error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response('Internal Server Error', { status: 500 });
      }) as typeof fetch;

      try {
        const request = createRequest('http://example.com/api/sync-webhooks', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-notify-token' },
        });
        const ctx = createExecutionContext();
        const env = createEnv({ GITHUB_TOKEN: 'ghp_test', WEBHOOK_URL: 'https://example.com/webhook' });
        const response = await worker.fetch(request, env, ctx as ExecutionContext);

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.status).toBe('error');
        expect(json.message).toContain('Failed to fetch repos');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
