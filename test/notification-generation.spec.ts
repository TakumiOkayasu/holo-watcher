import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/types';
import { TextGenerationError } from '../src/text-generation';

const generate = vi.hoisted(() => vi.fn());
vi.mock('../src/ai', () => ({ createTextGenerator: () => ({ generate }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('notification routes through the text generation boundary', () => {
  it.each(['/webhook', '/api/notify'])('%s preserves facts and handles generation failure', async (route) => {
    const put = vi.fn();
    const env: Env = {
      GITHUB_WEBHOOK_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'unused',
      NOTIFY_API_TOKEN: 'test-token', DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
      HOLO_HISTORY: { get: async () => null, put } as unknown as KVNamespace,
      DISCORD_PUBLIC_KEY: '', DISCORD_APPLICATION_ID: '', DISCORD_ALLOWED_GUILD_IDS: '',
      DISCORD_ALLOWED_USER_IDS: '', VAULTWARDEN_HEALTH_URL: '',
    };
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', transport);
    const url = 'https://github.com/owner/repo/actions/runs/123';
    const input = route === '/api/notify' ? {
      repo: 'owner/repo', workflow: 'CI', branch: 'main', commit: 'abcdef123',
      commit_msg: 'fixture', run_url: url, author: 'author', error_summary: 'failed step',
    } : {
      action: 'completed', repository: { full_name: 'owner/repo' },
      workflow_run: {
        name: 'CI', conclusion: 'failure', head_branch: 'main', head_sha: 'abcdef123',
        html_url: url, head_commit: { message: 'fixture', author: { name: 'author' } },
      },
    };
    const body = JSON.stringify(input);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    const headers = {
      Authorization: 'Bearer test-token', 'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${Array.from(signature, b => b.toString(16).padStart(2, '0')).join('')}`,
    };
    async function deliver() {
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request(`https://worker.test${route}`, {
        method: 'POST', body, headers,
      }), env, ctx);
      await waitOnExecutionContext(ctx);
      return response;
    }
    generate.mockResolvedValue('わっちからのお知らせじゃ');
    expect((await deliver()).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const success = JSON.parse(transport.mock.calls[0][1]!.body as string).embeds[0];
    expect(success.description).toBe('わっちからのお知らせじゃ');
    expect(success.title).toContain('CI失敗');
    expect(success.url).toBe(url);
    expect(success.fields[0].value).toBe('owner/repo');
    expect(put).toHaveBeenCalledTimes(1);

    generate.mockRejectedValue(new TextGenerationError('rate limited', 429));
    expect((await deliver()).status).toBe(202);
    const failure = JSON.parse(transport.mock.calls[1][1]!.body as string).embeds[0];
    expect(failure.title).toBe('⚠️ テキスト生成API エラー');
    expect(failure.description).toContain('レート制限');
    expect(failure.url).toBe(url);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
