import { describe, it, expect } from 'vitest';
import { validateEnv, parseDryRun, formatResult } from '../scripts/sync-webhooks';
import type { WebhookSyncResult } from '../src/types';

describe('sync-webhooks CLI', () => {
  describe('validateEnv', () => {
    it('should return config when all required env vars are set', () => {
      const result = validateEnv({
        GITHUB_TOKEN: 'ghp_test',
        WEBHOOK_URL: 'https://example.com/webhook',
        GITHUB_WEBHOOK_SECRET: 'secret123',
      });

      expect(result).toEqual({
        ok: true,
        config: {
          token: 'ghp_test',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret123',
        },
      });
    });

    it('should return error when GITHUB_TOKEN is missing', () => {
      const result = validateEnv({
        WEBHOOK_URL: 'https://example.com/webhook',
        GITHUB_WEBHOOK_SECRET: 'secret123',
      });

      expect(result).toEqual({ ok: false, missing: ['GITHUB_TOKEN'] });
    });

    it('should return error when WEBHOOK_URL is missing', () => {
      const result = validateEnv({
        GITHUB_TOKEN: 'ghp_test',
        GITHUB_WEBHOOK_SECRET: 'secret123',
      });

      expect(result).toEqual({ ok: false, missing: ['WEBHOOK_URL'] });
    });

    it('should return error when GITHUB_WEBHOOK_SECRET is missing', () => {
      const result = validateEnv({
        GITHUB_TOKEN: 'ghp_test',
        WEBHOOK_URL: 'https://example.com/webhook',
      });

      expect(result).toEqual({ ok: false, missing: ['GITHUB_WEBHOOK_SECRET'] });
    });

    it('should return all missing vars when multiple are absent', () => {
      const result = validateEnv({});

      expect(result).toEqual({
        ok: false,
        missing: ['GITHUB_TOKEN', 'WEBHOOK_URL', 'GITHUB_WEBHOOK_SECRET'],
      });
    });

    it('should treat empty string as missing', () => {
      const result = validateEnv({
        GITHUB_TOKEN: '',
        WEBHOOK_URL: 'https://example.com/webhook',
        GITHUB_WEBHOOK_SECRET: 'secret',
      });

      expect(result).toEqual({ ok: false, missing: ['GITHUB_TOKEN'] });
    });
  });

  describe('parseDryRun', () => {
    it('should return false when no args', () => {
      expect(parseDryRun([])).toBe(false);
    });

    it('should return true for --dry-run flag', () => {
      expect(parseDryRun(['--dry-run'])).toBe(true);
    });

    it('should return false for unrelated args', () => {
      expect(parseDryRun(['--verbose'])).toBe(false);
    });
  });

  describe('formatResult', () => {
    it('should format empty result', () => {
      const result: WebhookSyncResult = {
        created: [],
        deleted: [],
        unchanged: [],
        errors: [],
      };

      const output = formatResult(result);
      expect(output).toContain('Summary: 0 created, 0 deleted, 0 unchanged, 0 errors');
    });

    it('should include created repos', () => {
      const result: WebhookSyncResult = {
        created: ['owner/repo-1', 'owner/repo-2'],
        deleted: [],
        unchanged: [],
        errors: [],
      };

      const output = formatResult(result);
      expect(output).toContain('owner/repo-1');
      expect(output).toContain('owner/repo-2');
    });

    it('should include deleted repos', () => {
      const result: WebhookSyncResult = {
        created: [],
        deleted: ['owner/archived-repo'],
        unchanged: [],
        errors: [],
      };

      const output = formatResult(result);
      expect(output).toContain('owner/archived-repo');
    });

    it('should include errors', () => {
      const result: WebhookSyncResult = {
        created: [],
        deleted: [],
        unchanged: [],
        errors: [{ repo: 'owner/broken', error: 'Failed to create hook: 422' }],
      };

      const output = formatResult(result);
      expect(output).toContain('owner/broken');
      expect(output).toContain('Failed to create hook: 422');
    });

    it('should show counts for all categories', () => {
      const result: WebhookSyncResult = {
        created: ['owner/new'],
        deleted: ['owner/old'],
        unchanged: ['owner/same1', 'owner/same2'],
        errors: [{ repo: 'owner/err', error: 'fail' }],
      };

      const output = formatResult(result);
      expect(output).toContain('Summary: 1 created, 1 deleted, 2 unchanged, 1 errors');
    });
  });
});
