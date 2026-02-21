# holo-ci-workers

Cloudflare Workers 上で動作する CI 通知ボット。GitHub Actions の結果を「狼と香辛料」のホロの口調で Discord に送信する。

## Features

- GitHub Webhook 全 conclusion 対応 (success / failure / cancelled / skipped / timed_out / stale / action_required)
- Claude API によるホロ口調変換 (8パターン循環、KV で重複回避)
- Discord Rich Embed 送信
- GitHub API で失敗 job/step ログ自動取得
- `/api/notify` 手動通知エンドポイント (Bearer Token 認証)

## Tech Stack

| 項目 | 技術 |
| ------ | ------ |
| Runtime | Cloudflare Workers |
| Language | TypeScript (ES2024, strict) |
| Package Manager | bun |
| Test | Vitest + @cloudflare/vitest-pool-workers |
| Config | wrangler.jsonc |

## Endpoints

| Path | Method | 説明 |
| ------ | -------- | ------ |
| `/` `/health` | GET | ヘルスチェック |
| `/webhook` | POST | GitHub Webhook 受信 (HMAC-SHA256 署名検証) |
| `/api/notify` | POST | 手動通知 (Bearer Token 認証) |

## Setup

```bash
# 1. clone & install
git clone https://github.com/TakumiOkayasu/holo-ci-workers.git
cd holo-ci-workers
bun install

# 2. KV namespace 作成
wrangler kv namespace create HOLO_HISTORY
wrangler kv namespace create HOLO_HISTORY --preview

# 3. wrangler.jsonc の kv_namespaces[0].id に取得した ID を記載

# 4. Secrets 設定
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put DISCORD_WEBHOOK_URL
wrangler secret put NOTIFY_API_TOKEN
# オプション
wrangler secret put GITHUB_TOKEN
wrangler secret put ALLOWED_OWNER

# 5. 型生成
bun run cf-typegen
```

## Environment Variables

| 変数名 | 必須 | 説明 |
| -------- | ------ | ------ |
| `GITHUB_WEBHOOK_SECRET` | Yes | GitHub Webhook 署名検証用 Secret |
| `ANTHROPIC_API_KEY` | Yes | Claude API キー |
| `DISCORD_WEBHOOK_URL` | Yes | Discord Webhook URL |
| `NOTIFY_API_TOKEN` | Yes | `/api/notify` 認証用 Bearer Token |
| `GITHUB_TOKEN` | No | 失敗 job/step 詳細取得用 (Fine-grained PAT, actions:read) |
| `ALLOWED_OWNER` | No | 許可する GitHub アカウント/Organization 名 |

## Development

| コマンド | 説明 |
| ---------- | ------ |
| `bun run dev` | 開発サーバー起動 |
| `bun test` | テスト実行 |
| `bun test --watch` | watch モード |
| `bunx tsc --noEmit` | 型チェック |
| `bun run deploy` | デプロイ |

## Architecture

```text
src/
├── index.ts       # Workers エントリーポイント (fetch handler)
├── types.ts       # 型定義 (Env, GitHubErrorInfo, Discord 関連)
├── github.ts      # GitHub Webhook 署名検証 & ペイロード解析
├── github-api.ts  # GitHub API (失敗 job/step 取得)
├── claude.ts      # Claude API 統合 (ホロ口調変換)
├── discord.ts     # Discord Webhook 送信
└── history.ts     # Workers KV 履歴管理
```

### Request Flow (POST /webhook)

1. GitHub Webhook 受信
2. HMAC-SHA256 署名検証
3. オーナー検証 (`ALLOWED_OWNER` 設定時)
4. ペイロード解析 → `GitHubErrorInfo` 抽出
5. 失敗時: GitHub API で失敗 job/step 取得 (`GITHUB_TOKEN` 設定時)
6. KV から口調履歴読み込み
7. Claude API でホロ口調変換 (エラー詳細付き)
8. Discord Embed 送信 + 履歴保存 (`waitUntil`)
