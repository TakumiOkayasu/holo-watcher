import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveNotification, getRecentNotifications, isDuplicate } from '../src/history';
import type { NotificationInfo } from '../src/types';

describe('History (KV)', () => {
  const createNotificationInfo = (result: 'success' | 'failure'): NotificationInfo => ({
    result,
    workflowName: 'CI',
    repositoryName: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    branch: 'main',
    commitSha: 'abc123def456',
    runUrl: 'https://github.com/owner/repo/actions/runs/123',
    runNumber: 42,
    sender: 'developer',
  });

  const createMockKV = () => ({
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(),
  });

  describe('saveNotification', () => {
    it('should save notification to KV with TTL', async () => {
      const kv = createMockKV();
      const info = createNotificationInfo('success');

      await saveNotification(kv as unknown as KVNamespace, info);

      expect(kv.put).toHaveBeenCalledWith(
        expect.stringContaining('owner/repo'),
        expect.any(String),
        expect.objectContaining({ expirationTtl: expect.any(Number) })
      );
    });

    it('should include timestamp in key', async () => {
      const kv = createMockKV();
      const info = createNotificationInfo('success');

      await saveNotification(kv as unknown as KVNamespace, info);

      const key = kv.put.mock.calls[0][0];
      expect(key).toMatch(/^notification:/);
    });
  });

  describe('isDuplicate', () => {
    it('should return false for new notification', async () => {
      const kv = createMockKV();
      kv.get.mockResolvedValue(null);
      const info = createNotificationInfo('success');

      const result = await isDuplicate(kv as unknown as KVNamespace, info);

      expect(result).toBe(false);
    });

    it('should return true for duplicate notification', async () => {
      const kv = createMockKV();
      kv.get.mockResolvedValue('exists');
      const info = createNotificationInfo('success');

      const result = await isDuplicate(kv as unknown as KVNamespace, info);

      expect(result).toBe(true);
    });
  });

  describe('getRecentNotifications', () => {
    it('should return list of recent notifications', async () => {
      const kv = createMockKV();
      kv.list.mockResolvedValue({
        keys: [
          { name: 'notification:owner/repo:123:1' },
          { name: 'notification:owner/repo:456:2' },
        ],
      });
      kv.get.mockImplementation((key: string) => {
        if (key.includes('123')) {
          return Promise.resolve(JSON.stringify(createNotificationInfo('success')));
        }
        return Promise.resolve(JSON.stringify(createNotificationInfo('failure')));
      });

      const result = await getRecentNotifications(kv as unknown as KVNamespace, 'owner/repo', 10);

      expect(result).toHaveLength(2);
    });
  });
});
