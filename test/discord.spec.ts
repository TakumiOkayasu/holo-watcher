import { describe, it, expect, vi } from 'vitest';
import { sendToDiscord } from '../src/discord';
import type { GitHubErrorInfo, WorkflowConclusion } from '../src/types';

describe('Discord Webhook', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/123/abc';

  const createErrorInfo = (conclusion: WorkflowConclusion = 'failure'): GitHubErrorInfo => ({
    repo: 'owner/repo',
    workflow: 'CI',
    branch: 'main',
    commit: 'abc123def456789',
    commitMsg: 'fix: some bug',
    url: 'https://github.com/owner/repo/actions/runs/123',
    author: 'developer',
    conclusion,
  });

  const createMockFetch = (ok: boolean, status = 200) =>
    vi.fn().mockResolvedValue({ ok, status, text: async () => 'error body' });

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
    ).rejects.toThrow('Discord API error: 400 error body');
  });

  it.each([
    { conclusion: 'success' as const, color: 0x57f287, titleContains: '成功' },
    { conclusion: 'failure' as const, color: 0xed4245, titleContains: '失敗' },
    { conclusion: 'cancelled' as const, color: 0x95a5a6, titleContains: 'キャンセル' },
    { conclusion: 'skipped' as const, color: 0x99aab5, titleContains: 'スキップ' },
    { conclusion: 'timed_out' as const, color: 0xe67e22, titleContains: 'タイムアウト' },
    { conclusion: 'stale' as const, color: 0x7c3aed, titleContains: '古くなった' },
    { conclusion: 'action_required' as const, color: 0xf1c40f, titleContains: '対応が必要' },
  ])('should use correct color and title for $conclusion', async ({ conclusion, color, titleContains }) => {
    const mockFetch = createMockFetch(true);
    const errorInfo = createErrorInfo(conclusion);

    await sendToDiscord('テスト', errorInfo, webhookUrl, mockFetch);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.embeds[0].color).toBe(color);
    expect(body.embeds[0].title).toContain(titleContains);
  });
});
