/**
 * Discord Interactions の署名と認可に関する小さな境界。
 * Discord から届くbodyは、JSONへparseする前の生の文字列で必ず検証する。
 */

const encoder = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifyDiscordSignature(
  signature: string,
  timestamp: string,
  rawBody: string,
  publicKey: string,
): Promise<boolean> {
  const signatureBytes = hexToBytes(signature);
  const publicKeyBytes = hexToBytes(publicKey);
  if (!signatureBytes || !publicKeyBytes) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'Ed25519',
      key,
      signatureBytes,
      encoder.encode(timestamp + rawBody),
    );
  } catch {
    return false;
  }
}

export interface DiscordInteraction {
  type?: number;
  token?: string;
  guild_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: { name?: string };
}

export function isAllowedId(
  id: string | undefined,
  allowlist: string | undefined,
): boolean {
  if (!id || !allowlist) {
    return false;
  }
  return allowlist.split(',').some(candidate => candidate.trim() === id);
}

export function isAllowedDiscordInteraction(
  interaction: DiscordInteraction,
  allowedGuildIds: string | undefined,
  allowedUserIds: string | undefined,
): boolean {
  return isAllowedId(interaction.guild_id, allowedGuildIds)
    && isAllowedId(interaction.member?.user?.id ?? interaction.user?.id, allowedUserIds);
}

export function discordJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function ephemeralMessage(content: string): Response {
  return discordJson({
    type: 4,
    data: { content, flags: 64 },
  });
}
