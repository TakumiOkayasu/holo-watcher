/**
 * Webhook同期CLIスクリプト
 *
 * Usage:
 *   bun run sync-webhooks           # 全リポジトリのWebhookを同期
 *   bun run sync-webhooks --dry-run # 対象リポジトリ一覧のみ表示
 *
 * 必要な環境変数 (.env):
 *   GITHUB_TOKEN, WEBHOOK_URL, GITHUB_WEBHOOK_SECRET
 */

import { syncWebhooks, fetchAllUserRepos, type SyncConfig } from '../src/webhook-sync';
import type { WebhookSyncResult } from '../src/types';

// --- テスト可能なヘルパー ---

type ValidateResult =
  | { ok: true; config: SyncConfig }
  | { ok: false; missing: string[] };

const REQUIRED_VARS = ['GITHUB_TOKEN', 'WEBHOOK_URL', 'GITHUB_WEBHOOK_SECRET'] as const;

export function validateEnv(env: Record<string, string | undefined>): ValidateResult {
  const missing = REQUIRED_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: {
      token: env.GITHUB_TOKEN!,
      webhookUrl: env.WEBHOOK_URL!,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET!,
    },
  };
}

export function parseDryRun(args: string[]): boolean {
  return args.includes('--dry-run');
}

export function formatResult(result: WebhookSyncResult): string {
  const lines: string[] = [];

  if (result.created.length > 0) {
    lines.push(`\x1b[32m✅ Created (${result.created.length}):\x1b[0m`);
    for (const repo of result.created) lines.push(`   ${repo}`);
  }

  if (result.deleted.length > 0) {
    lines.push(`\x1b[33m🗑  Deleted (${result.deleted.length}):\x1b[0m`);
    for (const repo of result.deleted) lines.push(`   ${repo}`);
  }

  if (result.unchanged.length > 0) {
    lines.push(`\x1b[2m⏭  Unchanged (${result.unchanged.length}):\x1b[0m`);
    for (const repo of result.unchanged) lines.push(`   ${repo}`);
  }

  if (result.errors.length > 0) {
    lines.push(`\x1b[31m❌ Errors (${result.errors.length}):\x1b[0m`);
    for (const e of result.errors) lines.push(`   ${e.repo}: ${e.error}`);
  }

  lines.push('');
  lines.push(
    `Summary: ${result.created.length} created, ${result.deleted.length} deleted, ` +
    `${result.unchanged.length} unchanged, ${result.errors.length} errors`
  );

  return lines.join('\n');
}

// --- メイン処理 ---

async function main(): Promise<void> {
  const envResult = validateEnv(process.env);
  if (!envResult.ok) {
    console.error(`Missing required environment variables: ${envResult.missing.join(', ')}`);
    console.error('Set them in .env or export them before running.');
    process.exit(1);
  }

  const { config } = envResult;
  const dryRun = parseDryRun(process.argv.slice(2));

  if (dryRun) {
    console.log('Dry run: fetching repository list...\n');
    const repos = await fetchAllUserRepos(config.token, fetch);
    const active = repos.filter((r) => !r.archived);
    const archived = repos.filter((r) => r.archived);

    console.log(`Active repositories (${active.length}):`);
    for (const r of active) console.log(`  ${r.full_name}`);

    if (archived.length > 0) {
      console.log(`\nArchived repositories (${archived.length}):`);
      for (const r of archived) console.log(`  ${r.full_name}`);
    }

    console.log(`\nTotal: ${repos.length} repositories`);
    return;
  }

  console.log('Syncing webhooks for all repositories...\n');
  const result = await syncWebhooks(config);
  console.log(formatResult(result));

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
