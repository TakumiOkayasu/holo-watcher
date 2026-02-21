import type { GitHubErrorInfo, DiscordWebhookPayload, WorkflowConclusion } from './types';

const CONCLUSION_STYLE: Record<WorkflowConclusion, { color: number; title: string }> = {
  success:         { color: 0x57f287, title: '🐺 CI成功じゃ!' },
  failure:         { color: 0xed4245, title: '🐺 CI失敗のお知らせじゃ' },
  cancelled:       { color: 0x95a5a6, title: '🐺 CIがキャンセルされたのじゃ' },
  skipped:         { color: 0x99aab5, title: '🐺 CIがスキップされたのじゃ' },
  timed_out:       { color: 0xe67e22, title: '🐺 CIがタイムアウトしたのじゃ' },
  stale:           { color: 0x7c3aed, title: '🐺 CIが古くなったのじゃ' },
  action_required: { color: 0xf1c40f, title: '🐺 CIに対応が必要じゃ!' },
};

/**
 * ホロ口調メッセージをDiscordに送信
 * @param message ホロ口調化されたメッセージ
 * @param errorInfo CI結果情報
 * @param webhookUrl Discord Webhook URL
 */
export async function sendToDiscord(
  message: string,
  errorInfo: GitHubErrorInfo,
  webhookUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const style = CONCLUSION_STYLE[errorInfo.conclusion];
  const payload: DiscordWebhookPayload = {
    username: 'CI結果を教えてくれるホロ',
    embeds: [
      {
        title: style.title,
        description: message,
        color: style.color,
        fields: [
          { name: '📦 リポジトリ', value: errorInfo.repo, inline: true },
          { name: '🌿 ブランチ', value: errorInfo.branch, inline: true },
          { name: '👤 作者', value: errorInfo.author, inline: true },
          {
            name: '💬 コミット',
            value: errorInfo.commitMsg.substring(0, 100),
            inline: false,
          },
        ],
        footer: { text: `Commit: ${errorInfo.commit.substring(0, 7)}` },
        url: errorInfo.url,
      },
    ],
  };

  const response = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord API error: ${response.status} ${body}`.trim());
  }
}

/**
 * Claude APIエラーをDiscordに通知
 */
export async function sendErrorToDiscord(
  errorMessage: string,
  errorInfo: GitHubErrorInfo | null,
  webhookUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const fields = errorInfo
    ? [
        { name: '📦 リポジトリ', value: errorInfo.repo, inline: true },
        { name: '🌿 ブランチ', value: errorInfo.branch, inline: true },
        { name: '👤 作者', value: errorInfo.author, inline: true },
        { name: '💬 コミット', value: errorInfo.commitMsg.substring(0, 100), inline: false },
      ]
    : [];

  const payload: DiscordWebhookPayload = {
    username: 'CI結果を教えてくれるホロ',
    embeds: [
      {
        title: '⚠️ Claude API エラー',
        description: errorMessage,
        color: 0xfee75c,
        fields,
        footer: { text: errorInfo ? `Commit: ${errorInfo.commit.substring(0, 7)}` : 'CI情報なし' },
        url: errorInfo?.url,
      },
    ],
  };

  const response = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord API error: ${response.status} ${body}`.trim());
  }
}
