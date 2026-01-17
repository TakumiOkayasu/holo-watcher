import type { WorkflowRunPayload, NotificationInfo, CIResult } from './types';

/**
 * GitHub Webhook署名を検証
 * Web Crypto APIを使用 (Node.js cryptoは使用不可)
 */
export async function verifySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = signature.slice(7);
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // タイミング攻撃対策: 固定時間比較
    if (expectedSignature.length !== computedSignature.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < expectedSignature.length; i++) {
      result |= expectedSignature.charCodeAt(i) ^ computedSignature.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}

/**
 * workflow_runイベントを解析してNotificationInfoを返す
 * 成功/失敗以外(cancelled, skipped, 未完了)はnullを返す
 */
export function parseWorkflowRun(payload: WorkflowRunPayload): NotificationInfo | null {
  if (payload.action !== 'completed') {
    return null;
  }

  const conclusion = payload.workflow_run.conclusion;
  if (conclusion !== 'success' && conclusion !== 'failure') {
    return null;
  }

  const result: CIResult = conclusion;

  return {
    result,
    workflowName: payload.workflow_run.name,
    repositoryName: payload.repository.full_name,
    repositoryUrl: payload.repository.html_url,
    branch: payload.workflow_run.head_branch,
    commitSha: payload.workflow_run.head_sha,
    runUrl: payload.workflow_run.html_url,
    runNumber: payload.workflow_run.run_number,
    sender: payload.sender.login,
  };
}
