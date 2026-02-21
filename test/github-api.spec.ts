import { describe, it, expect, vi } from 'vitest';
import { fetchErrorSummary } from '../src/github-api';

describe('fetchErrorSummary', () => {
  const repo = 'owner/repo';
  const runId = 12345678;
  const token = 'ghp_test_token';

  const createJobsResponse = (jobs: Array<{
    name: string;
    conclusion: string;
    steps?: Array<{ name: string; conclusion: string }>;
  }>) => ({
    ok: true,
    status: 200,
    json: async () => ({ jobs }),
  });

  const createMockFetch = (response: any) =>
    vi.fn().mockResolvedValue(response);

  it('should extract failed job and step names', async () => {
    const mockFetch = createMockFetch(createJobsResponse([
      {
        name: 'build',
        conclusion: 'failure',
        steps: [
          { name: 'Checkout', conclusion: 'success' },
          { name: 'Run tests', conclusion: 'failure' },
        ],
      },
    ]));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);

    expect(result).not.toBeNull();
    expect(result).toContain('build');
    expect(result).toContain('Run tests');
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      })
    );
  });

  it('should return null when all steps succeed', async () => {
    const mockFetch = createMockFetch(createJobsResponse([
      {
        name: 'build',
        conclusion: 'success',
        steps: [
          { name: 'Checkout', conclusion: 'success' },
          { name: 'Run tests', conclusion: 'success' },
        ],
      },
    ]));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);
    expect(result).toBeNull();
  });

  it('should handle jobs without step info', async () => {
    const mockFetch = createMockFetch(createJobsResponse([
      { name: 'build', conclusion: 'failure' },
    ]));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);

    expect(result).not.toBeNull();
    expect(result).toContain('build');
    expect(result).toContain('(不明)');
  });

  it('should return null on API 404', async () => {
    const mockFetch = createMockFetch({ ok: false, status: 404 });

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);
    expect(result).toBeNull();
  });

  it('should return null on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);
    expect(result).toBeNull();
  });

  it('should truncate output at 800 characters', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => ({
      name: `very-long-job-name-that-takes-space-${i}`,
      conclusion: 'failure' as const,
      steps: [
        { name: `failing-step-with-a-long-description-${i}`, conclusion: 'failure' },
      ],
    }));
    const mockFetch = createMockFetch(createJobsResponse(jobs));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);

    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(800);
  });

  it('should handle multiple failed jobs', async () => {
    const mockFetch = createMockFetch(createJobsResponse([
      {
        name: 'lint',
        conclusion: 'failure',
        steps: [{ name: 'ESLint', conclusion: 'failure' }],
      },
      {
        name: 'test',
        conclusion: 'failure',
        steps: [{ name: 'Vitest', conclusion: 'failure' }],
      },
    ]));

    const result = await fetchErrorSummary(repo, runId, token, mockFetch);

    expect(result).not.toBeNull();
    expect(result).toContain('lint');
    expect(result).toContain('ESLint');
    expect(result).toContain('test');
    expect(result).toContain('Vitest');
  });
});
