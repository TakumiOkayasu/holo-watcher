import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const encoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

async function createSigner() {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey)));
  return {
    publicKey,
    async sign(body: string, timestamp: string): Promise<string> {
      const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, encoder.encode(timestamp + body));
      return bytesToHex(new Uint8Array(signature));
    },
  };
}

function createEnv(publicKey: string) {
  return {
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    ANTHROPIC_API_KEY: 'test-api-key',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test',
    HOLO_HISTORY: {} as KVNamespace,
    NOTIFY_API_TOKEN: 'test-notify-token',
    DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_APPLICATION_ID: 'application-id',
    DISCORD_ALLOWED_GUILD_IDS: 'allowed-guild',
    DISCORD_ALLOWED_USER_IDS: 'allowed-user',
    VAULTWARDEN_HEALTH_URL: 'https://vault.example.test/alive?token=must-not-leak',
  } as never;
}

function createContext() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    context: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
    } as ExecutionContext,
  };
}

async function aliveRequest(publicKey: string, sign: (body: string, timestamp: string) => Promise<string>) {
  const timestamp = '1725062400';
  const body = JSON.stringify({
    type: 2,
    token: 'interaction-token',
    guild_id: 'allowed-guild',
    member: { user: { id: 'allowed-user' } },
    data: { name: 'alive' },
  });
  return new Request('https://worker.example.test/discord/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': await sign(body, timestamp),
      'X-Signature-Timestamp': timestamp,
    },
    body,
  });
}

describe('/alive command behavior', () => {
  it('returns a deferred ephemeral response before checking the public endpoint', async () => {
    const signer = await createSigner();
    const { context, pending } = createContext();
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const response = await worker.fetch(
        await aliveRequest(signer.publicKey, signer.sign),
        createEnv(signer.publicKey),
        context,
      );

      await expect(response.json()).resolves.toEqual({ type: 5, data: { flags: 64 } });
      expect(pending).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    { name: 'healthy 200', healthResponse: new Response('private health body', { status: 200 }), expected: 'healthy', status: '200' },
    { name: 'unhealthy non-2xx', healthResponse: new Response('Cloudflare internal diagnostic', { status: 530 }), expected: 'unhealthy', status: '530' },
  ])('edits the ephemeral response with classified $name status only', async ({ healthResponse, expected, status }) => {
    const signer = await createSigner();
    const { context, pending } = createContext();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(healthResponse)
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await worker.fetch(
        await aliveRequest(signer.publicKey, signer.sign),
        createEnv(signer.publicKey),
        context,
      );
      await Promise.all(pending);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [editUrl, editRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
      const payload = JSON.parse(editRequest.body as string);
      expect(editUrl).toBe('https://discord.com/api/v10/webhooks/application-id/interaction-token/messages/@original');
      expect(payload.allowed_mentions).toEqual({ parse: [] });
      expect(payload.content).toContain(`Vaultwarden: ${expected}`);
      expect(payload.content).toContain(`HTTP: ${status}`);
      expect(payload.content).toContain('Latency:');
      expect(payload.content).toContain('Checked:');
      expect(payload.content).toContain('Target: public');
      expect(payload.content).not.toContain('private health body');
      expect(payload.content).not.toContain('Cloudflare internal diagnostic');
      expect(payload.content).not.toContain('must-not-leak');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('classifies a timeout as unhealthy without exposing the thrown detail', async () => {
    const signer = await createSigner();
    const { context, pending } = createContext();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('request to 10.0.0.12 failed with credential=secret', 'AbortError'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await worker.fetch(
        await aliveRequest(signer.publicKey, signer.sign),
        createEnv(signer.publicKey),
        context,
      );
      await Promise.all(pending);

      const [, editRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
      const payload = JSON.parse(editRequest.body as string);
      expect(payload.content).toContain('Vaultwarden: unhealthy');
      expect(payload.content).toContain('HTTP: unavailable');
      expect(payload.content).not.toContain('10.0.0.12');
      expect(payload.content).not.toContain('credential=secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
