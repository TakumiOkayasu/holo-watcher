import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('CI Notification Worker', () => {
  describe('HTTP method handling', () => {
    it('should return 405 for GET requests', async () => {
      const request = new IncomingRequest('http://example.com');
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(405);
    });

    it('should return 405 for PUT requests', async () => {
      const request = new IncomingRequest('http://example.com', { method: 'PUT' });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(405);
    });
  });

  describe('GitHub Webhook handling', () => {
    it('should return 401 for missing signature', async () => {
      const request = new IncomingRequest('http://example.com', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'workflow_run',
        },
        body: '{}',
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
    });

    it('should return 400 for non-workflow_run events', async () => {
      const request = new IncomingRequest('http://example.com', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': 'sha256=dummy',
        },
        body: '{}',
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(400);
    });

    it('should return 200 for ping event', async () => {
      const request = new IncomingRequest('http://example.com', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'ping',
        },
        body: '{}',
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('pong');
    });
  });

  describe('Health check', () => {
    it('should return 200 for /health endpoint', async () => {
      const request = new IncomingRequest('http://example.com/health');
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
    });
  });
});
