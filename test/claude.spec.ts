import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertToHolo } from '../src/claude';
import type { GitHubErrorInfo } from '../src/types';

// モックの create 関数を外部から参照できるようにする
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'わっちは嬉しいのじゃ！CIが成功したぞ！' }],
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('Claude API', () => {
  const mockApiKey = 'test-api-key';

  const createErrorInfo = (conclusion: 'success' | 'failure'): GitHubErrorInfo => ({
    repo: 'owner/repo',
    workflow: 'CI',
    branch: 'main',
    commit: 'abc123def456789',
    commitMsg: 'fix: some bug',
    url: 'https://github.com/owner/repo/actions/runs/123',
    author: 'developer',
    conclusion,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate message for successful CI', async () => {
    const info = createErrorInfo('success');
    const history: string[] = [];
    const message = await convertToHolo(info, history, mockApiKey);

    expect(message).toBe('わっちは嬉しいのじゃ！CIが成功したぞ！');
  });

  it('should generate message for failed CI', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    const message = await convertToHolo(info, history, mockApiKey);

    expect(typeof message).toBe('string');
  });

  it('should update history after generation', async () => {
    const info = createErrorInfo('success');
    const history: string[] = [];
    await convertToHolo(info, history, mockApiKey);

    expect(history.length).toBe(1);
  });

  it('should keep history max 5 items', async () => {
    const info = createErrorInfo('success');
    const history = ['1', '2', '3', '4', '5'];
    await convertToHolo(info, history, mockApiKey);

    expect(history.length).toBe(5);
  });

  it('should include errorSummary in prompt when provided', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    await convertToHolo(info, history, mockApiKey, 'Error: test failed at line 42');

    const createCall = mockCreate.mock.calls[0][0];
    const prompt = createCall.messages[0].content as string;
    expect(prompt).toContain('【エラー詳細】');
    expect(prompt).toContain('Error: test failed at line 42');
  });

  it('should not include error detail section without errorSummary', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    await convertToHolo(info, history, mockApiKey);

    const createCall = mockCreate.mock.calls[0][0];
    const prompt = createCall.messages[0].content as string;
    expect(prompt).not.toContain('【エラー詳細】');
  });
});
