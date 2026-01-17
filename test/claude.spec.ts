import { describe, it, expect, vi } from 'vitest';
import { generateHoloMessage } from '../src/claude';
import type { NotificationInfo } from '../src/types';

describe('Claude API', () => {
  const mockApiKey = 'test-api-key';

  const createNotificationInfo = (result: 'success' | 'failure'): NotificationInfo => ({
    result,
    workflowName: 'CI',
    repositoryName: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    branch: 'main',
    commitSha: 'abc123',
    runUrl: 'https://github.com/owner/repo/actions/runs/123',
    runNumber: 42,
    sender: 'developer',
  });

  const createMockFetch = (response: { ok: boolean; status?: number; data?: unknown }) => {
    return vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.ok ? 'OK' : 'Internal Server Error',
      json: () => Promise.resolve(response.data),
    });
  };

  it('should generate message for successful CI', async () => {
    const mockFetch = createMockFetch({
      ok: true,
      data: {
        content: [{ type: 'text', text: 'わっちは嬉しいのじゃ！CIが成功したぞ！' }],
      },
    });

    const info = createNotificationInfo('success');
    const message = await generateHoloMessage(info, mockApiKey, mockFetch);

    expect(message).toBe('わっちは嬉しいのじゃ！CIが成功したぞ！');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': mockApiKey,
        }),
      })
    );
  });

  it('should generate message for failed CI', async () => {
    const mockFetch = createMockFetch({
      ok: true,
      data: {
        content: [{ type: 'text', text: 'ぬしよ、CIが失敗しておるぞ。早く直すのじゃ。' }],
      },
    });

    const info = createNotificationInfo('failure');
    const message = await generateHoloMessage(info, mockApiKey, mockFetch);

    expect(message).toBe('ぬしよ、CIが失敗しておるぞ。早く直すのじゃ。');
  });

  it('should throw error when API fails', async () => {
    const mockFetch = createMockFetch({
      ok: false,
      status: 500,
    });

    const info = createNotificationInfo('success');
    await expect(generateHoloMessage(info, mockApiKey, mockFetch)).rejects.toThrow(
      'Claude API error'
    );
  });

  it('should include CI info in the prompt', async () => {
    const mockFetch = createMockFetch({
      ok: true,
      data: {
        content: [{ type: 'text', text: 'テストメッセージ' }],
      },
    });

    const info = createNotificationInfo('success');
    await generateHoloMessage(info, mockApiKey, mockFetch);

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const userMessage = body.messages[0].content;

    expect(userMessage).toContain('owner/repo');
    expect(userMessage).toContain('CI');
    expect(userMessage).toContain('main');
    expect(userMessage).toContain('成功');
  });
});
