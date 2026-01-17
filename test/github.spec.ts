import { describe, it, expect } from 'vitest';
import { verifySignature, parseWorkflowRun } from '../src/github';
import type { WorkflowRunPayload, NotificationInfo } from '../src/types';

describe('GitHub Webhook', () => {
  describe('verifySignature', () => {
    const secret = 'test-secret';

    it('should return true for valid signature', async () => {
      const payload = '{"test": "data"}';
      // 事前計算されたHMAC-SHA256署名
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const signature = `sha256=${signatureHex}`;

      const result = await verifySignature(payload, signature, secret);
      expect(result).toBe(true);
    });

    it('should return false for invalid signature', async () => {
      const payload = '{"test": "data"}';
      const signature = 'sha256=invalid-signature';

      const result = await verifySignature(payload, signature, secret);
      expect(result).toBe(false);
    });

    it('should return false for missing sha256 prefix', async () => {
      const payload = '{"test": "data"}';
      const signature = 'invalid-format';

      const result = await verifySignature(payload, signature, secret);
      expect(result).toBe(false);
    });
  });

  describe('parseWorkflowRun', () => {
    const createPayload = (conclusion: 'success' | 'failure'): WorkflowRunPayload => ({
      action: 'completed',
      workflow_run: {
        id: 123,
        name: 'CI',
        head_branch: 'main',
        head_sha: 'abc123',
        conclusion,
        html_url: 'https://github.com/owner/repo/actions/runs/123',
        run_number: 42,
        run_attempt: 1,
      },
      repository: {
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
      },
      sender: {
        login: 'user',
        avatar_url: 'https://example.com/avatar.png',
      },
    });

    it('should parse successful workflow run', () => {
      const payload = createPayload('success');
      const result = parseWorkflowRun(payload);

      expect(result).not.toBeNull();
      expect(result?.result).toBe('success');
      expect(result?.workflowName).toBe('CI');
      expect(result?.repositoryName).toBe('owner/repo');
      expect(result?.branch).toBe('main');
    });

    it('should parse failed workflow run', () => {
      const payload = createPayload('failure');
      const result = parseWorkflowRun(payload);

      expect(result).not.toBeNull();
      expect(result?.result).toBe('failure');
    });

    it('should return null for non-completed action', () => {
      const payload = createPayload('success');
      payload.action = 'requested';
      const result = parseWorkflowRun(payload);

      expect(result).toBeNull();
    });

    it('should return null for cancelled workflow', () => {
      const payload: WorkflowRunPayload = {
        ...createPayload('success'),
        workflow_run: {
          ...createPayload('success').workflow_run,
          conclusion: 'cancelled',
        },
      };
      const result = parseWorkflowRun(payload);

      expect(result).toBeNull();
    });
  });
});
