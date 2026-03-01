import type { Env, NotifyRequest, GitHubErrorInfo } from './types';
import { verifyGitHubSignature, parseWebhook } from './github';
import { verifyBearerToken } from './auth';
import { convertToHolo } from './claude';
import { sendToDiscord, sendErrorToDiscord } from './discord';
import { buildApiErrorMessage } from './errors';
import { loadHistory, saveHistory } from './history';
import { fetchErrorSummary } from './github-api';
import { syncWebhooks, type SyncConfig } from './webhook-sync';

/**
 * Cloudflare Workers エントリーポイント
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS対応(プリフライトリクエスト)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature-256, Authorization',
        },
      });
    }

    const url = new URL(request.url);

    // ルーティング
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, ctx);
    }

    if (url.pathname === '/api/notify' && request.method === 'POST') {
      return handleNotify(request, env, ctx);
    }

    if (url.pathname === '/api/sync-webhooks' && request.method === 'POST') {
      return handleSyncWebhooks(request, env);
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'holo-ci-bot',
          message: 'わっちは元気じゃぞ!',
        }),
        {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * /api/notify 処理ハンドラー (CI失敗詳細通知)
 */
async function handleNotify(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // 1. Bearer token認証
    const authHeader = request.headers.get('Authorization');
    if (!(await verifyBearerToken(authHeader, env.NOTIFY_API_TOKEN))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 2. JSON解析
    let body: NotifyRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Invalid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. バリデーション
    if (!body.repo || !body.workflow || !body.run_url) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. GitHubErrorInfoに変換
    const errorInfo: GitHubErrorInfo = {
      repo: body.repo,
      workflow: body.workflow,
      branch: body.branch,
      commit: body.commit,
      commitMsg: body.commit_msg,
      url: body.run_url,
      author: body.author,
      conclusion: 'failure',
    };

    // 5. エラーサマリーを1000文字でキャップ + Fix PR情報を付加
    let errorSummary = body.error_summary?.substring(0, 1000) ?? '';
    if (body.has_fix_pr && body.fix_pr_url) {
      errorSummary += `\n\n自動修正PRが作成されました: ${body.fix_pr_url}`;
    }

    // 6. 履歴読み込み + ホロ口調化
    const history = await loadHistory(env.HOLO_HISTORY);
    let holoMessage: string;
    try {
      holoMessage = await convertToHolo(errorInfo, history, env.ANTHROPIC_API_KEY, errorSummary || undefined);
    } catch (error) {
      const errorMessage = buildApiErrorMessage(error);
      console.error('Claude API error:', errorMessage);
      ctx.waitUntil(
        sendErrorToDiscord(errorMessage, errorInfo, env.DISCORD_WEBHOOK_URL)
          .catch(e => console.error('Discord notification failed:', e))
      );
      return new Response(
        JSON.stringify({ status: 'accepted', error: errorMessage }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Discord送信(非同期)
    ctx.waitUntil(
      sendToDiscord(holoMessage, errorInfo, env.DISCORD_WEBHOOK_URL)
        .catch(e => console.error('Discord notification failed:', e))
    );

    // 8. 履歴保存(非同期)
    ctx.waitUntil(
      saveHistory(env.HOLO_HISTORY, history)
        .catch(e => console.error('History save failed:', e))
    );

    return new Response(
      JSON.stringify({ status: 'success', preview: holoMessage.substring(0, 50) + '...' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GitHub Webhook処理ハンドラー
 */
async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // 1. リクエストボディ取得
    const body = await request.text();
    const signature = request.headers.get('X-Hub-Signature-256');

    // 2. 署名検証
    if (!signature || !(await verifyGitHubSignature(signature, body, env.GITHUB_WEBHOOK_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 3. ペイロード解析
    const payload = JSON.parse(body);

    // 3.5. オーナー検証 (ALLOWED_OWNERが設定されている場合のみ、カンマ区切り複数対応)
    if (env.ALLOWED_OWNER) {
      const allowedOwners = new Set(
        env.ALLOWED_OWNER.split(',').map(s => s.trim()).filter(Boolean)
      );
      const owner = payload.repository?.owner?.login;
      if (!owner || !allowedOwners.has(owner)) {
        return new Response(
          JSON.stringify({ status: 'ignored', reason: 'unauthorized owner' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3.6. アーカイブ済みリポジトリはスキップ
    if (payload.repository?.archived) {
      return new Response(
        JSON.stringify({ status: 'ignored', reason: 'archived repository' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const errorInfo = parseWebhook(payload);

    if (!errorInfo) {
      // 対象外イベントの場合はスキップ
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not a target event' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. 失敗時はエラー詳細を取得 (GITHUB_TOKENがある場合のみ)
    let errorSummary: string | undefined;
    if (errorInfo.conclusion !== 'success' && env.GITHUB_TOKEN && errorInfo.runId) {
      errorSummary =
        (await fetchErrorSummary(errorInfo.repo, errorInfo.runId, env.GITHUB_TOKEN))
        ?? undefined;
    }

    // 5. 履歴読み込み
    const history = await loadHistory(env.HOLO_HISTORY);

    // 6. ホロ口調化
    let holoMessage: string;
    try {
      holoMessage = await convertToHolo(errorInfo, history, env.ANTHROPIC_API_KEY, errorSummary);
    } catch (error) {
      const errorMessage = buildApiErrorMessage(error);
      console.error('Claude API error:', errorMessage);
      ctx.waitUntil(
        sendErrorToDiscord(errorMessage, errorInfo, env.DISCORD_WEBHOOK_URL)
          .catch(e => console.error('Discord notification failed:', e))
      );
      return new Response(
        JSON.stringify({ status: 'accepted', error: errorMessage }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Discord送信(非同期で実行、レスポンスを待たない)
    ctx.waitUntil(
      sendToDiscord(holoMessage, errorInfo, env.DISCORD_WEBHOOK_URL)
        .catch(e => console.error('Discord notification failed:', e))
    );

    // 7. 履歴保存(非同期)
    ctx.waitUntil(
      saveHistory(env.HOLO_HISTORY, history)
        .catch(e => console.error('History save failed:', e))
    );

    // 8. 即座にレスポンス返却
    return new Response(
      JSON.stringify({
        status: 'success',
        preview: holoMessage.substring(0, 50) + '...',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * /api/sync-webhooks 処理ハンドラー
 */
async function handleSyncWebhooks(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!(await verifyBearerToken(authHeader, env.NOTIFY_API_TOKEN))) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (!env.GITHUB_TOKEN || !env.WEBHOOK_URL) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'GITHUB_TOKEN and WEBHOOK_URL are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config: SyncConfig = {
      token: env.GITHUB_TOKEN,
      webhookUrl: env.WEBHOOK_URL,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    };
    const result = await syncWebhooks(config);
    return new Response(
      JSON.stringify({ status: 'success', ...result }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync webhooks error:', error);
    return new Response(
      JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
