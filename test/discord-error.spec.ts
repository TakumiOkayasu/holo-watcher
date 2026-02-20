import { describe, it, expect, vi } from 'vitest';
import type { GitHubErrorInfo } from '../src/types';
import { sendErrorToDiscord } from '../src/discord';

describe('sendErrorToDiscord', () => {
  const mockErrorInfo: GitHubErrorInfo = {
    repo: 'owner/repo',
    workflow: 'CI',
    branch: 'main',
    commit: 'abc1234567890',
    commitMsg: 'fix something',
    url: 'https://github.com/owner/repo/actions/runs/1',
    author: 'tester',
    conclusion: 'failure',
  };

  it('should send embed with yellow color and error title', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendErrorToDiscord('残高不足です', mockErrorInfo, 'https://discord.com/webhook', mockFetch);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://discord.com/webhook');

    const payload = JSON.parse(options.body);
    const embed = payload.embeds[0];
    expect(embed.color).toBe(0xfee75c);
    expect(embed.title).toBe('⚠️ Claude API エラー');
  });

  it('should include CI info fields when errorInfo is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendErrorToDiscord('エラーメッセージ', mockErrorInfo, 'https://discord.com/webhook', mockFetch);

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const fields = payload.embeds[0].fields;
    expect(fields).toHaveLength(4);
    expect(fields[0].value).toBe('owner/repo');
    expect(fields[1].value).toBe('main');
    expect(fields[2].value).toBe('tester');
    expect(fields[3].value).toBe('fix something');
  });

  it('should have empty fields when errorInfo is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendErrorToDiscord('エラーメッセージ', null, 'https://discord.com/webhook', mockFetch);

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const embed = payload.embeds[0];
    expect(embed.fields).toHaveLength(0);
    expect(embed.footer.text).toBe('CI情報なし');
    expect(embed.url).toBeUndefined();
  });

  it('should throw on fetch failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad Request' });
    await expect(
      sendErrorToDiscord('エラー', mockErrorInfo, 'https://discord.com/webhook', mockFetch)
    ).rejects.toThrow('Discord API error: 400 Bad Request');
  });
});
