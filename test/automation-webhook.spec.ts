import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/types';
import { convertToHolo } from '../src/claude';

vi.mock('../src/claude', () => ({ convertToHolo: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setup() {
  const values = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  const env: Env = {
    GITHUB_WEBHOOK_SECRET: 'unit-test-secret',
    ANTHROPIC_API_KEY: 'unused-test-key',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/unit/test',
    HOLO_HISTORY: kv as unknown as KVNamespace,
    ALLOWED_OWNER: 'owner',
    NOTIFY_GITHUB_LOGIN: 'owner',
    NOTIFY_API_TOKEN: 'unused-test-token',
    DISCORD_PUBLIC_KEY: '',
    DISCORD_APPLICATION_ID: '',
    DISCORD_ALLOWED_GUILD_IDS: '',
    DISCORD_ALLOWED_USER_IDS: '',
    VAULTWARDEN_HEALTH_URL: '',
  };
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  return { env, kv, transport };
}

function payload(event = 'pull_request') {
  return {
    action: 'opened',
    repository: { full_name: 'owner/repo', archived: false, owner: { login: 'owner' } },
    [event === 'issues' ? 'issue' : 'pull_request']: {
      number: 17,
      title: 'Automated finding',
      body: 'synthetic description; not sent to a model',
      state: 'open',
      user: { login: 'github-actions[bot]', type: 'Bot' },
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
    },
  };
}

async function deliver(input: unknown, env: Env, event = 'pull_request', validSignature = true) {
  const body = JSON.stringify(input);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  const signature = `sha256=${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return worker.fetch(new Request('https://worker.test/webhook', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-Hub-Signature-256': validSignature ? signature : 'sha256=invalid',
    },
  }), env, createExecutionContext());
}

describe('signed automation webhook integration', () => {
  it.each(['pull_request', 'issues'])('delivers %s without calling the model, and deduplicates redelivery', async event => {
    const { env, transport } = setup();
    const first = await deliver(payload(event), env, event);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'sent' });
    const second = await deliver(payload(event), env, event);
    expect(await second.json()).toEqual({ status: 'duplicate' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toContain('discord.com/api/webhooks/');
    expect(convertToHolo).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'bad-signature', 'wrong-owner', 'archived'])('performs no extra I/O for %s', async scenario => {
    const { env, kv, transport } = setup();
    const input = payload();
    if (scenario === 'disabled') delete env.NOTIFY_GITHUB_LOGIN;
    if (scenario === 'wrong-owner') input.repository.owner.login = 'other';
    if (scenario === 'archived') input.repository.archived = true;
    const response = await deliver(input, env, 'pull_request', scenario !== 'bad-signature');
    expect(response.status).toBe(scenario === 'bad-signature' ? 401 : scenario === 'wrong-owner' ? 403 : 200);
    if (response.status === 200) expect(await response.json()).toMatchObject({ status: 'ignored' });
    expect(transport).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(convertToHolo).not.toHaveBeenCalled();
  });

  it('returns a generic failure, does not mark sent, and permits a later retry', async () => {
    const { env, kv, transport } = setup();
    transport.mockRejectedValueOnce(new Error('secret-upstream-detail'));
    const response = await deliver(payload(), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ status: 'error', message: 'Automation notification failed' });
    expect(kv.put).not.toHaveBeenCalled();
    expect(await (await deliver(payload(), env)).json()).toEqual({ status: 'sent' });
    expect(convertToHolo).not.toHaveBeenCalled();
  });
});
