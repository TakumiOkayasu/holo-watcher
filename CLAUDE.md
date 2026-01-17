# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cloudflare Workers上で動作するサーバーレスBot。GitHub Actions CIの結果(成功/失敗)を「狼と香辛料」のホロの口調でDiscordに送信する。

- Runtime: Cloudflare Workers
- Language: TypeScript (ES2024)
- Package Manager: bun
- Testing: Vitest with @cloudflare/vitest-pool-workers
- Config: wrangler.jsonc (JSONC形式、TOMLではない)

## Commands

```bash
# 開発サーバー起動
bun run dev

# テスト実行
bun test

# watchモード
bun test --watch

# 単一テストファイル実行
bun test test/index.spec.ts

# 型生成 (Env型をworker-configuration.d.tsに生成)
bun run cf-typegen

# TypeScript型チェック
bunx tsc --noEmit

# デプロイ
bun run deploy
```

## Architecture

```
src/
├── index.ts          # Workers エントリーポイント (fetch handler)
├── types.ts          # 型定義 (Env, GitHubErrorInfo, Discord関連)
├── github.ts         # GitHub Webhook署名検証 & ペイロード解析
├── claude.ts         # Claude API統合 (ホロ口調変換)
├── discord.ts        # Discord Webhook送信
└── history.ts        # Workers KV履歴管理

test/
├── index.spec.ts     # テスト (unit style & integration style)
├── env.d.ts          # cloudflare:test モジュール型拡張
└── tsconfig.json     # テスト用TypeScript設定
```

## Key Patterns

### Cloudflare Workers固有
- Node.js crypto は使用不可。Web Crypto API (`crypto.subtle`) を使用
- KVNamespaceはEnv経由でバインド
- ExecutionContext.waitUntil() で非同期処理を登録 (レスポンス返却後も継続)

### テスト
- `cloudflare:test` からインポート (`env`, `createExecutionContext`, `SELF`)
- Unit style: worker.fetch() を直接呼び出し
- Integration style: SELF.fetch() でWorkers環境統合テスト

### 環境変数
Secretsはwrangler secret putで設定:
- GITHUB_WEBHOOK_SECRET
- ANTHROPIC_API_KEY
- DISCORD_WEBHOOK_URL

### リクエストフロー
1. GitHub Webhook受信 (POST /)
2. 署名検証 (github.ts:verifySignature)
3. ペイロード解析 (github.ts:parseWorkflowRun)
4. 重複チェック (history.ts:isDuplicate)
5. 202即座レスポンス + ctx.waitUntil()で非同期処理:
   - Claude API呼び出し (claude.ts:generateHoloMessage)
   - Discord送信 (discord.ts:sendDiscordNotification)
   - 履歴保存 (history.ts:saveNotification)

## Configuration Files

- `wrangler.jsonc`: Workers設定 (main, compatibility_date, kv_namespaces)
  - KV namespace ID設定が必要: `wrangler kv namespace create NOTIFICATION_HISTORY`で作成後、IDをwrangler.jsonc:16に記載
- `vitest.config.mts`: Vitest設定 (@cloudflare/vitest-pool-workers使用)
- `tsconfig.json`: strict: true, target: es2024, moduleResolution: Bundler
