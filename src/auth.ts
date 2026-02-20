const COMPARISON_KEY = 'holo-ci-workers-token-comparison';

/**
 * Bearer token検証 (constant-time比較)
 * 固定キーでHMACダイジェストを生成し比較することで、
 * トークン長・内容のタイミングリークを防止する。
 * @param authHeader Authorizationヘッダー値
 * @param expectedToken 期待するトークン
 * @returns 検証結果
 */
export async function verifyBearerToken(
  authHeader: string | null,
  expectedToken: string
): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  const encoder = new TextEncoder();

  // 固定キーでHMAC → 長さの違いもダイジェスト比較に吸収される
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(COMPARISON_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const [sig1, sig2] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(token)),
    crypto.subtle.sign('HMAC', key, encoder.encode(expectedToken)),
  ]);

  const a = new Uint8Array(sig1);
  const b = new Uint8Array(sig2);

  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
