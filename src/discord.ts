import type { GitHubErrorInfo, DiscordWebhookPayload } from './types';

/**
 * ホロ口調メッセージをDiscordに送信
 * @param message ホロ口調化されたメッセージ
 * @param errorInfo CI失敗情報
 * @param webhookUrl Discord Webhook URL
 */
export async function sendToDiscord(
  message: string,
  errorInfo: GitHubErrorInfo,
  webhookUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
	const payload: DiscordWebhookPayload = {
		username: 'CI結果を教えてくれるホロ',
    embeds: [
      {
        title: '🐺 CI失敗のお知らせじゃ',
        description: message,
        color: 0xed4245, // 赤色
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
    throw new Error(`Discord API error: ${response.status}`);
  }
}
