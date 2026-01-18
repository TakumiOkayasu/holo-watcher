import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('CI Notification Worker', () => {
  const createRequest = (url: string, options?: RequestInit) =>
    new Request(url, options);

  const createExecutionContext = () => ({
    waitUntil: () => {},
    passThroughOnException: () => {},
  });

  const createEnv = () => ({
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    ANTHROPIC_API_KEY: 'test-api-key',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test',
    HOLO_HISTORY: {} as KVNamespace,
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
});
