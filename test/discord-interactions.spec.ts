import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const encoder = new TextEncoder();

interface InteractionSigner {
  publicKeyHex: string;
  sign(body: string, timestamp: string): Promise<string>;
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

async function createInteractionSigner(): Promise<InteractionSigner> {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

  return {
    publicKeyHex: bytesToHex(publicKey),
    async sign(body: string, timestamp: string): Promise<string> {
      const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, encoder.encode(timestamp + body));
      return bytesToHex(new Uint8Array(signature));
    },
  };
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    ANTHROPIC_API_KEY: 'test-api-key',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test',
    HOLO_HISTORY: {} as KVNamespace,
    NOTIFY_API_TOKEN: 'test-notify-token',
    DISCORD_PUBLIC_KEY: '00'.repeat(32),
    DISCORD_APPLICATION_ID: 'application-id',
    DISCORD_ALLOWED_GUILD_IDS: 'allowed-guild',
    DISCORD_ALLOWED_USER_IDS: 'allowed-user',
    VAULTWARDEN_HEALTH_URL: 'https://vault.example.test/alive',
    ...overrides,
  } as never;
}

function createContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

async function signedInteraction(
  body: string,
  signer: InteractionSigner,
): Promise<Request> {
  const timestamp = '1725062400';
  return new Request('https://worker.example.test/discord/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': await signer.sign(body, timestamp),
      'X-Signature-Timestamp': timestamp,
    },
    body,
  });
}

describe('Discord interactions security contract', () => {
  it('returns 401 when either signature header is missing', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example.test/discord/interactions', {
        method: 'POST',
        body: JSON.stringify({ type: 1 }),
      }),
      createEnv(),
      createContext(),
    );

    expect(response.status).toBe(401);
  });

  it('returns 401 for an invalid Ed25519 signature', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example.test/discord/interactions', {
        method: 'POST',
        body: JSON.stringify({ type: 1 }),
        headers: {
          'X-Signature-Ed25519': '00'.repeat(64),
          'X-Signature-Timestamp': '1725062400',
        },
      }),
      createEnv(),
      createContext(),
    );

    expect(response.status).toBe(401);
  });

  it('verifies timestamp plus the unparsed raw body and answers a valid PING', async () => {
    const signer = await createInteractionSigner();
    const body = '{\n  "type": 1\n}';
    const response = await worker.fetch(
      await signedInteraction(body, signer),
      createEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex }),
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it('returns an ephemeral denial for an unallowlisted user', async () => {
    const signer = await createInteractionSigner();
    const body = JSON.stringify({
      type: 2,
      guild_id: 'allowed-guild',
      member: { user: { id: 'unallowed-user' } },
      data: { name: 'alive' },
    });
    const response = await worker.fetch(
      await signedInteraction(body, signer),
      createEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex }),
      createContext(),
    );

    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: expect.objectContaining({ flags: 64 }),
    });
  });

  it('returns an ephemeral denial for an unallowlisted guild', async () => {
    const signer = await createInteractionSigner();
    const body = JSON.stringify({
      type: 2,
      guild_id: 'unallowed-guild',
      member: { user: { id: 'allowed-user' } },
      data: { name: 'alive' },
    });
    const response = await worker.fetch(
      await signedInteraction(body, signer),
      createEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex }),
      createContext(),
    );

    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: expect.objectContaining({ flags: 64 }),
    });
  });

  it('rejects DM interactions and unknown commands ephemerally', async () => {
    const signer = await createInteractionSigner();
    const dmBody = JSON.stringify({
      type: 2,
      user: { id: 'allowed-user' },
      data: { name: 'alive' },
    });
    const unknownBody = JSON.stringify({
      type: 2,
      guild_id: 'allowed-guild',
      member: { user: { id: 'allowed-user' } },
      data: { name: 'unknown' },
    });

    for (const body of [dmBody, unknownBody]) {
      const response = await worker.fetch(
        await signedInteraction(body, signer),
        createEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex }),
        createContext(),
      );
      await expect(response.json()).resolves.toEqual({
        type: 4,
        data: expect.objectContaining({ flags: 64 }),
      });
    }
  });
});
