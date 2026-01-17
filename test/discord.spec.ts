import { describe, it, expect, vi } from 'vitest';
import { sendDiscordNotification, buildDiscordPayload } from '../src/discord';
import type { NotificationInfo } from '../src/types';

describe('Discord Webhook', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/123/abc';

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

  describe('buildDiscordPayload', () => {
    it('should build payload for successful CI with green color', () => {
      const info = createNotificationInfo('success');
      const holoMessage = 'わっちは嬉しいのじゃ！';
      const payload = buildDiscordPayload(info, holoMessage);

      expect(payload.username).toBe('賢狼ホロ');
      expect(payload.embeds).toHaveLength(1);
      expect(payload.embeds![0].color).toBe(0x00ff00); // green
      expect(payload.embeds![0].description).toBe(holoMessage);
      expect(payload.embeds![0].title).toContain('成功');
    });

    it('should build payload for failed CI with red color', () => {
      const info = createNotificationInfo('failure');
      const holoMessage = 'ぬしよ、失敗じゃ...';
      const payload = buildDiscordPayload(info, holoMessage);

      expect(payload.embeds![0].color).toBe(0xff0000); // red
      expect(payload.embeds![0].title).toContain('失敗');
    });

    it('should include repository and workflow info in fields', () => {
      const info = createNotificationInfo('success');
      const payload = buildDiscordPayload(info, 'test message');

      const fields = payload.embeds![0].fields!;
      expect(fields.some((f) => f.value.includes('owner/repo'))).toBe(true);
      expect(fields.some((f) => f.value.includes('main'))).toBe(true);
      expect(fields.some((f) => f.value.includes('abc123d'))).toBe(true); // short sha
    });
  });

  describe('sendDiscordNotification', () => {
    it('should send POST request to webhook URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      const info = createNotificationInfo('success');
      const holoMessage = 'テストメッセージ';

      await sendDiscordNotification(webhookUrl, info, holoMessage, mockFetch);

      expect(mockFetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw error when webhook fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      const info = createNotificationInfo('success');

      await expect(
        sendDiscordNotification(webhookUrl, info, 'test', mockFetch)
      ).rejects.toThrow('Discord webhook error');
    });
  });
});
