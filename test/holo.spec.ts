import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertToHolo } from '../src/holo';
import type { GitHubErrorInfo, WorkflowConclusion } from '../src/types';

const mockGenerate = vi.fn();
const generator = { generate: mockGenerate };

describe('Holo notification wording', () => {
  const createErrorInfo = (conclusion: WorkflowConclusion): GitHubErrorInfo => ({
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
    vi.resetAllMocks();
    mockGenerate.mockResolvedValue('わっちは嬉しいのじゃ！CIが成功したぞ！');
  });

  it('should generate message for successful CI', async () => {
    const info = createErrorInfo('success');
    const history: string[] = [];
    const message = await convertToHolo(info, history, generator);

    expect(message).toBe('わっちは嬉しいのじゃ！CIが成功したぞ！');
  });

  it('should generate message for failed CI', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    const message = await convertToHolo(info, history, generator);

    expect(typeof message).toBe('string');
  });

  it('should update history after generation', async () => {
    const info = createErrorInfo('success');
    const history: string[] = [];
    await convertToHolo(info, history, generator);

    expect(history.length).toBe(1);
  });

  it('should keep history max 5 items', async () => {
    const info = createErrorInfo('success');
    const history = ['1', '2', '3', '4', '5'];
    await convertToHolo(info, history, generator);

    expect(history.length).toBe(5);
  });

  it('should include errorSummary in prompt when provided', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    await convertToHolo(info, history, generator, 'Error: test failed at line 42');

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain('【エラー詳細】');
    expect(prompt).toContain('Error: test failed at line 42');
  });

  it('should not include error detail section without errorSummary', async () => {
    const info = createErrorInfo('failure');
    const history: string[] = [];
    await convertToHolo(info, history, generator);

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).not.toContain('【エラー詳細】');
  });

  it('should include CIキャンセル in prompt for cancelled conclusion', async () => {
    const info = createErrorInfo('cancelled');
    const history: string[] = [];
    await convertToHolo(info, history, generator);

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain('CIキャンセル');
  });
  it('does not record a tone when generation fails', async () => {
    const history = ['previous'];
    mockGenerate.mockRejectedValue(new Error('failed'));
    await expect(convertToHolo(createErrorInfo('failure'), history, generator)).rejects.toThrow('failed');
    expect(history).toEqual(['previous']);
  });

  it('rejects empty output without changing history', async () => {
    const history = ['previous'];
    mockGenerate.mockResolvedValue('  ');
    await expect(convertToHolo(createErrorInfo('success'), history, generator)).rejects.toThrow('Empty text response');
    expect(history).toEqual(['previous']);
  });

  it('keeps the notification facts unchanged across provider substitution', async () => {
    const info = createErrorInfo('failure');
    const original = { ...info };
    const alternative = { generate: async () => '  別の生成実装じゃ  ' };
    expect(await convertToHolo(info, [], alternative)).toBe('別の生成実装じゃ');
    expect(info).toEqual(original);
  });
});
