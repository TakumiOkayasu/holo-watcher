import type { NotificationInfo, DiscordWebhookPayload, DiscordEmbed } from './types';
import type { FetchFn } from './claude';

const HOLO_AVATAR_URL = 'https://i.imgur.com/8ZKqMqL.png';

/**
 * Discord Embed用のペイロードを構築
 */
export function buildDiscordPayload(
  info: NotificationInfo,
  holoMessage: string
): DiscordWebhookPayload {
  const isSuccess = info.result === 'success';
  const color = isSuccess ? 0x00ff00 : 0xff0000;
  const statusText = isSuccess ? '✅ CI 成功' : '❌ CI 失敗';
  const shortSha = info.commitSha.slice(0, 7);

  const embed: DiscordEmbed = {
    title: `${statusText}: ${info.workflowName}`,
    description: holoMessage,
    color,
    fields: [
      {
        name: 'リポジトリ',
        value: `[${info.repositoryName}](${info.repositoryUrl})`,
        inline: true,
      },
      {
        name: 'ブランチ',
        value: info.branch,
        inline: true,
      },
      {
        name: 'コミット',
        value: `[${shortSha}](${info.runUrl})`,
        inline: true,
      },
      {
        name: '実行者',
        value: info.sender,
        inline: true,
      },
      {
        name: '実行番号',
        value: `#${info.runNumber}`,
        inline: true,
      },
    ],
    footer: {
      text: '賢狼ホロ CI通知',
    },
    timestamp: new Date().toISOString(),
  };

  return {
    username: '賢狼ホロ',
    avatar_url: HOLO_AVATAR_URL,
    embeds: [embed],
  };
}

/**
 * Discord Webhookに通知を送信
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  info: NotificationInfo,
  holoMessage: string,
  fetchFn: FetchFn = fetch
): Promise<void> {
  const payload = buildDiscordPayload(info, holoMessage);

  const response = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook error: ${response.status} ${response.statusText}`);
  }
}
