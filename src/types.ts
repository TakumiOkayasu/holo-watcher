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

  // GitHub API Token (失敗ログ取得用、オプション)
  GITHUB_TOKEN?: string;

  // 許可するGitHubアカウント/Organization名 (カンマ区切りで複数指定可、オプション)
  ALLOWED_OWNER?: string;

  // /api/notify エンドポイント認証用トークン
  NOTIFY_API_TOKEN: string;

  // Webhook同期先URL (例: https://workers.murata-lab.net/webhook)
  WEBHOOK_URL?: string;
}

/**
 * GitHub workflow_run の conclusion 値
 */
export type WorkflowConclusion =
  | 'success' | 'failure' | 'cancelled' | 'skipped'
  | 'timed_out' | 'stale' | 'action_required';

/**
 * GitHub CI結果情報
 */
export interface GitHubErrorInfo {
  repo: string;          // リポジトリ名(例: owner/repo)
  workflow: string;      // ワークフロー名
  branch: string;        // ブランチ名
  commit: string;        // コミットハッシュ(フル)
  commitMsg: string;     // コミットメッセージ
  url: string;           // GitHub Actions実行URL
  author: string;        // コミット作者
  conclusion: WorkflowConclusion; // CI結果
  runId?: number;        // workflow_run.id (GitHub API呼び出し用)
}

/**
 * /api/notify エンドポイントのリクエストボディ
 */
export interface NotifyRequest {
  repo: string;
  workflow: string;
  branch: string;
  run_id: string;
  run_url: string;
  commit: string;
  commit_msg: string;
  author: string;
  error_summary: string;
  has_fix_pr?: boolean;
  fix_pr_url?: string;
}

/**
 * Webhook同期結果
 */
export interface WebhookSyncResult {
  created: string[];
  deleted: string[];
  unchanged: string[];
  errors: Array<{ repo: string; error: string }>;
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
  url?: string;
}

/**
 * Discord Webhook送信ペイロード
 */
export interface DiscordWebhookPayload {
	username?: string;
  embeds: DiscordEmbed[];
}
