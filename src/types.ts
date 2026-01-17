/**
 * Cloudflare Workers環境変数
 */
export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  NOTIFICATION_HISTORY: KVNamespace;
}

/**
 * GitHub workflow_run イベントのペイロード
 */
export interface WorkflowRunPayload {
  action: string;
  workflow_run: {
    id: number;
    name: string;
    head_branch: string;
    head_sha: string;
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
    html_url: string;
    run_number: number;
    run_attempt: number;
  };
  repository: {
    full_name: string;
    html_url: string;
  };
  sender: {
    login: string;
    avatar_url: string;
  };
}

/**
 * CI結果の種別
 */
export type CIResult = 'success' | 'failure';

/**
 * 通知情報
 */
export interface NotificationInfo {
  result: CIResult;
  workflowName: string;
  repositoryName: string;
  repositoryUrl: string;
  branch: string;
  commitSha: string;
  runUrl: string;
  runNumber: number;
  sender: string;
}

/**
 * Discord Embed構造
 */
export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

/**
 * Discord Webhookペイロード
 */
export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}
