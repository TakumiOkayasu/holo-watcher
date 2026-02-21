import type { GitHubErrorInfo, WorkflowConclusion } from './types';

/**
 * GitHub Webhook署名検証(HMAC-SHA256)
 * @param signature リクエストヘッダーのX-Hub-Signature-256
 * @param body リクエストボディ(文字列)
 * @param secret Webhook Secret
 * @returns 検証結果
 */
export async function verifyGitHubSignature(
  signature: string,
  body: string,
  secret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(body);

  try {
    // Web Crypto APIでHMACキーをインポート
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 署名のhex文字列をバイト列に変換
    const signatureHex = signature.replace('sha256=', '');
    const signatureBytes = hexToBytes(signatureHex);

    // HMAC検証(constant-time比較)
    return await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, data);
  } catch {
    return false;
  }
}

/**
 * hex文字列をUint8Arrayに変換
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

const VALID_CONCLUSIONS: ReadonlySet<string> = new Set<WorkflowConclusion>([
  'success', 'failure', 'cancelled', 'skipped',
  'timed_out', 'stale', 'action_required',
]);

/**
 * GitHub Webhookペイロードを解析してCI結果情報を抽出
 * @param payload GitHubからのWebhookペイロード
 * @returns CI結果情報(対象外の場合はnull)
 */
export function parseWebhook(payload: any): GitHubErrorInfo | null {
  // workflow_run イベントの completed アクションのみ処理
  if (payload.action !== 'completed') {
    return null;
  }

  const run = payload.workflow_run;
  if (!run || !VALID_CONCLUSIONS.has(run.conclusion)) {
    return null;
  }

  // PRマージコミット(重複通知)をスキップ
  const commitMsg = run.head_commit?.message || '';
  if (commitMsg.startsWith('Merge pull request')) {
    return null;
  }

  // CI結果情報を抽出
  return {
    repo: payload.repository.full_name,
    workflow: run.name,
    branch: run.head_branch,
    commit: run.head_sha,
    commitMsg: run.head_commit?.message || '',
    url: run.html_url,
    author: run.head_commit?.author?.name || 'Unknown',
    conclusion: run.conclusion as WorkflowConclusion,
    runId: run.id,
  };
}
