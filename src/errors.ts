import { TextGenerationError } from './text-generation';

const STATUS_MESSAGES: Record<number, string> = {
  401: 'APIキーが無効です。設定を確認してください。',
  402: 'APIの残高が不足しています。チャージが必要です。',
  429: 'APIのレート制限に達しました。しばらくお待ちください。',
  529: 'APIが過負荷状態です。後ほどお試しください。',
};

export function buildApiErrorMessage(error: unknown): string {
  if (error instanceof TextGenerationError && error.status !== undefined) {
    return STATUS_MESSAGES[error.status]
      ?? `テキスト生成APIエラー (HTTP ${error.status}): ${error.message}`;
  }
  return `テキスト生成APIエラー: ${error instanceof Error ? error.message : '不明なエラー'}`;
}
