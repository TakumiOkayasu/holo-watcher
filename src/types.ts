/**
 * Cloudflare Workers環境変数の型定義
 */
export interface Env {
  // GitHub Webhook検証用Secret
  GITHUB_WEBHOOK_SECRET: string;

  // Anthropic API Key
  ANTHROPIC_API_KEY: string;

  // Discord Webhook URL
  DISCORD_WEBHOOK_URL: string;

  // Workers KV Namespace(口調履歴保存用)
  HOLO_HISTORY: KVNamespace;
}

/**
 * GitHub CI失敗情報
 */
export interface GitHubErrorInfo {
  repo: string;          // リポジトリ名(例: owner/repo)
  workflow: string;      // ワークフロー名
  branch: string;        // ブランチ名
  commit: string;        // コミットハッシュ(フル)
  commitMsg: string;     // コミットメッセージ
  url: string;           // GitHub Actions実行URL
  author: string;        // コミット作者
}

/**
 * Discord Embed構造
 */
export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }>;
  footer: {
    text: string;
  };
  url: string;
}

/**
 * Discord Webhook送信ペイロード
 */
export interface DiscordWebhookPayload {
	username?: string;
  embeds: DiscordEmbed[];
}
