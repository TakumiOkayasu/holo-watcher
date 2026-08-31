import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPublicHealth } from '../src/health';

afterEach(() => {
  vi.useRealTimers();
});

describe('public health checker', () => {
  it('aborts after the timeout and classifies the result without details', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('private upstream detail', 'AbortError'));
        });
      }));

    const resultPromise = checkPublicHealth(
      'https://vault.example.test/alive?token=secret',
      fetchMock as typeof fetch,
      () => 1_000,
    );
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      healthy: false,
      status: null,
      error: 'timeout',
      target: 'public',
    }));
  });

  it('bypasses caches and classifies network failures', async () => {
    const successFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await checkPublicHealth(
      'https://vault.example.test/alive',
      successFetch as typeof fetch,
      () => 1_000,
    );

    expect(successFetch).toHaveBeenCalledWith(
      'https://vault.example.test/alive',
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: expect.any(AbortSignal),
      }),
    );

    const networkResult = await checkPublicHealth(
      'https://vault.example.test/alive',
      vi.fn().mockRejectedValue(new Error('private address 10.0.0.5')) as typeof fetch,
      () => 2_000,
    );
    expect(networkResult).toEqual(expect.objectContaining({
      healthy: false,
      status: null,
      error: 'network',
      target: 'public',
    }));
    expect(JSON.stringify(networkResult)).not.toContain('10.0.0.5');
  });
});
