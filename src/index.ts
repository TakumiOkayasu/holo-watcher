import type { Env } from './types';
import { verifyGitHubSignature, parseWebhook } from './github';
import { convertToHolo } from './claude';
import { sendToDiscord } from './discord';
import { loadHistory, saveHistory } from './history';

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
          'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature-256',
        },
      });
    }

    const url = new URL(request.url);

    // ルーティング
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, ctx);
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

    // 3.5. オーナー検証 (ALLOWED_OWNERが設定されている場合のみ)
    if (env.ALLOWED_OWNER) {
      const owner = payload.repository?.owner?.login;
      if (owner !== env.ALLOWED_OWNER) {
        return new Response(
          JSON.stringify({ status: 'ignored', reason: 'unauthorized owner' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const errorInfo = parseWebhook(payload);

    if (!errorInfo) {
      // 失敗イベントでない場合はスキップ
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not a failure event' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. 履歴読み込み
    const history = await loadHistory(env.HOLO_HISTORY);

    // 5. ホロ口調化
    const holoMessage = await convertToHolo(errorInfo, history, env.ANTHROPIC_API_KEY);

    // 6. Discord送信(非同期で実行、レスポンスを待たない)
    ctx.waitUntil(sendToDiscord(holoMessage, errorInfo, env.DISCORD_WEBHOOK_URL));

    // 7. 履歴保存(非同期)
    ctx.waitUntil(saveHistory(env.HOLO_HISTORY, history));

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
