export interface HealthResult {
  target: 'public';
  healthy: boolean;
  status: number | null;
  latencyMs: number;
  checkedAt: string;
  error?: 'timeout' | 'network' | 'http';
}

const HEALTH_TIMEOUT_MS = 5_000;

/**
 * 公開経路だけを確認する. Response bodyは読まないため、診断情報をDiscordへ
 * 流出させる経路を作らない。
 */
export async function checkPublicHealth(
  healthUrl: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<HealthResult> {
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetchFn(healthUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    const latencyMs = now() - startedAt;
    if (!response.ok) {
      return {
        target: 'public',
        healthy: false,
        status: response.status,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: 'http',
      };
    }
    return {
      target: 'public',
      healthy: true,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const latencyMs = now() - startedAt;
    const timeoutError = error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError';
    return {
      target: 'public',
      healthy: false,
      status: null,
      latencyMs,
      checkedAt: new Date().toISOString(),
      error: timeoutError ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatHealthResult(result: HealthResult): string {
  return [
    `Vaultwarden: ${result.healthy ? 'healthy' : 'unhealthy'}`,
    `HTTP: ${result.status ?? 'unavailable'}`,
    `Latency: ${result.latencyMs} ms`,
    `Checked: ${result.checkedAt}`,
    `Target: ${result.target}`,
  ].join('\n');
}
