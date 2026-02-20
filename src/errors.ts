import Anthropic from '@anthropic-ai/sdk';

const STATUS_MESSAGES: Record<number, string> = {
  401: 'APIキーが無効です。設定を確認してください。',
  402: 'APIの残高が不足しています。チャージが必要です。',
  429: 'APIのレート制限に達しました。しばらくお待ちください。',
  529: 'APIが過負荷状態です。後ほどお試しください。',
};

export function buildApiErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return STATUS_MESSAGES[error.status ?? 0]
      ?? `Claude APIエラー (HTTP ${error.status}): ${error.message}`;
  }
  return `Claude APIエラー: ${error instanceof Error ? error.message : '不明なエラー'}`;
}
