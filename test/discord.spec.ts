import { describe, it, expect, vi } from 'vitest';
import { sendToDiscord } from '../src/discord';
import type { GitHubErrorInfo } from '../src/types';

describe('Discord Webhook', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/123/abc';

  const createErrorInfo = (): GitHubErrorInfo => ({
    repo: 'owner/repo',
    workflow: 'CI',
    branch: 'main',
    commit: 'abc123def456789',
    commitMsg: 'fix: some bug',
    url: 'https://github.com/owner/repo/actions/runs/123',
    author: 'developer',
  });

  const createMockFetch = (ok: boolean, status = 200) =>
    vi.fn().mockResolvedValue({ ok, status });

  it('should set username to "CI結果を教えてくれるホロ"', async () => {
    const mockFetch = createMockFetch(true);
    const errorInfo = createErrorInfo();

    await sendToDiscord('テストメッセージ', errorInfo, webhookUrl, mockFetch);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.username).toBe('CI結果を教えてくれるホロ');
  });

  it('should send POST request with correct headers', async () => {
    const mockFetch = createMockFetch(true);
    const errorInfo = createErrorInfo();

    await sendToDiscord('テストメッセージ', errorInfo, webhookUrl, mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    );
  });

  it('should include error info in embed fields', async () => {
    const mockFetch = createMockFetch(true);
    const errorInfo = createErrorInfo();

    await sendToDiscord('テストメッセージ', errorInfo, webhookUrl, mockFetch);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].description).toBe('テストメッセージ');
    expect(body.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'owner/repo' }),
        expect.objectContaining({ value: 'main' }),
        expect.objectContaining({ value: 'developer' }),
      ])
    );
  });

  it('should throw error when webhook fails', async () => {
    const mockFetch = createMockFetch(false, 400);
    const errorInfo = createErrorInfo();

    await expect(
      sendToDiscord('test', errorInfo, webhookUrl, mockFetch)
    ).rejects.toThrow('Discord API error: 400');
  });
});
