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
    const createPayload = (conclusion: string) => ({
      action: 'completed',
      workflow_run: {
        id: 12345678,
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

    it('should parse cancelled workflow run', () => {
      const payload = createPayload('cancelled');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('cancelled');
    });

    it('should parse skipped workflow run', () => {
      const payload = createPayload('skipped');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('skipped');
    });

    it('should parse timed_out workflow run', () => {
      const payload = createPayload('timed_out');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('timed_out');
    });

    it('should parse stale workflow run', () => {
      const payload = createPayload('stale');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('stale');
    });

    it('should parse action_required workflow run', () => {
      const payload = createPayload('action_required');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.conclusion).toBe('action_required');
    });

    it('should extract runId from workflow_run', () => {
      const payload = createPayload('failure');
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
      expect(result?.runId).toBe(12345678);
    });

    it('should return null for unknown conclusion', () => {
      const payload = createPayload('unknown_value');
      const result = parseWebhook(payload);

      expect(result).toBeNull();
    });

    it('should return null for merge commit (PR merge)', () => {
      const payload = createPayload('success');
      payload.workflow_run.head_commit.message =
        'Merge pull request #21 from user/feature-branch';
      const result = parseWebhook(payload);

      expect(result).toBeNull();
    });

    it('should not skip non-merge commits on main', () => {
      const payload = createPayload('success');
      payload.workflow_run.head_commit.message = 'feat: add new feature';
      const result = parseWebhook(payload);

      expect(result).not.toBeNull();
    });
  });
});
