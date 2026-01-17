import type { Env, WorkflowRunPayload } from './types';
import { verifySignature, parseWorkflowRun } from './github';
import { generateHoloMessage } from './claude';
import { sendDiscordNotification } from './discord';
import { saveNotification, isDuplicate } from './history';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ヘルスチェック
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POSTのみ受け付け
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const eventType = request.headers.get('X-GitHub-Event');

    // pingイベント
    if (eventType === 'ping') {
      return new Response(JSON.stringify({ message: 'pong' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // workflow_runイベントのみ処理
    if (eventType !== 'workflow_run') {
      return new Response('Only workflow_run events are supported', { status: 400 });
    }

    // 署名検証
    const signature = request.headers.get('X-Hub-Signature-256');
    if (!signature) {
      return new Response('Missing signature', { status: 401 });
    }

    const body = await request.text();

    const isValid = await verifySignature(body, signature, env.GITHUB_WEBHOOK_SECRET);
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }

    // ペイロード解析
    const payload = JSON.parse(body) as WorkflowRunPayload;
    const notificationInfo = parseWorkflowRun(payload);

    if (!notificationInfo) {
      return new Response('Ignored (not a completed success/failure)', { status: 200 });
    }

    // 重複チェック
    const duplicate = await isDuplicate(env.NOTIFICATION_HISTORY, notificationInfo);
    if (duplicate) {
      return new Response('Duplicate notification ignored', { status: 200 });
    }

    // 非同期で通知処理 (レスポンスを即座に返す)
    ctx.waitUntil(
      (async () => {
        try {
          // ホロ口調メッセージ生成
          const holoMessage = await generateHoloMessage(notificationInfo, env.ANTHROPIC_API_KEY);

          // Discord送信
          await sendDiscordNotification(env.DISCORD_WEBHOOK_URL, notificationInfo, holoMessage);

          // 履歴保存
          await saveNotification(env.NOTIFICATION_HISTORY, notificationInfo);
        } catch (error) {
          console.error('Notification failed:', error);
        }
      })()
    );

    return new Response('Notification queued', { status: 202 });
  },
} satisfies ExportedHandler<Env>;
