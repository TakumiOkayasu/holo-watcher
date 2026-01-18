import { describe, it, expect } from 'vitest';
import { verifyGitHubSignature, parseWebhook } from '../src/github';

describe('GitHub Webhook', () => {
  describe('verifyGitHubSignature', () => {
    const secret = 'test-secret';

    it('should return true for valid signature', async () => {
      const body = '{"test": "data"}';
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const signature = `sha256=${signatureHex}`;

      const result = await verifyGitHubSignature(signature, body, secret);
      expect(result).toBe(true);
    });

    it('should return false for invalid signature', async () => {
      const body = '{"test": "data"}';
      const signature = 'sha256=invalid-signature';

      const result = await verifyGitHubSignature(signature, body, secret);
      expect(result).toBe(false);
    });

    it('should return false for missing sha256 prefix', async () => {
      const body = '{"test": "data"}';
      const signature = 'invalid-format';

      const result = await verifyGitHubSignature(signature, body, secret);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    const createPayload = (conclusion: 'success' | 'failure') => ({
      action: 'completed',
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        head_sha: 'abc123def456789',
        conclusion,
        html_url: 'https://github.com/owner/repo/actions/runs/123',
        head_commit: {
          message: 'fix: some bug',
          author: { name: 'developer' },
        },
      },
      repository: {
        full_name: 'owner/repo',
      },
    });

    it('should parse successful workflow run', () => {
      const payload = createPayload('success');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('success');
      expect(result?.workflow).toBe('CI');
      expect(result?.repo).toBe('owner/repo');
      expect(result?.branch).toBe('main');
    });

    it('should parse failed workflow run', () => {
      const payload = createPayload('failure');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('failure');
    });

    it('should return null for non-completed action', () => {
      const payload = createPayload('success');
      payload.action = 'requested';
      const result = parseWebhook(payload);

      expect(result).toBeNull();
    });

    it('should return null for cancelled workflow', () => {
      const payload = {
        ...createPayload('success'),
        workflow_run: {
          ...createPayload('success').workflow_run,
          conclusion: 'cancelled',
        },
      };
      const result = parseWebhook(payload);

      expect(result).toBeNull();
    });
  });
});
