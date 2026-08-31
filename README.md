# holo-ci-workers

Cloudflare Workers 上で動作する CI 通知ボット。GitHub Actions の結果を「狼と香辛料」のホロの口調で Discord に送信する。

## Features

- GitHub Webhook 全 conclusion 対応 (success / failure / cancelled / skipped / timed_out / stale / action_required)
- Claude API によるホロ口調変換 (8パターン循環、KV で重複回避)
- Discord Rich Embed 送信
- GitHub API で失敗 job/step ログ自動取得
- `/api/notify` 手動通知エンドポイント (Bearer Token 認証)
- `/api/sync-webhooks` 全リポジトリの Webhook 一括同期 (rate limit 検出・早期打ち切り対応)
- Discord Interactions Endpointによるguild限定の`/alive`公開経路確認

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
| `/api/sync-webhooks` | POST | 全リポジトリ Webhook 一括同期 (Bearer Token 認証) |
| `/discord/interactions` | POST | Discord Interactions受信 (Ed25519署名検証) |

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
wrangler secret put WEBHOOK_URL
wrangler secret put ALLOWED_OWNER
# Discord Interactions `/alive`
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_ALLOWED_GUILD_IDS
wrangler secret put DISCORD_ALLOWED_USER_IDS
wrangler secret put VAULTWARDEN_HEALTH_URL

# 5. 型生成
bun run cf-typegen
```

## Environment Variables

| 変数名 | 必須 | 説明 |
| -------- | ------ | ------ |
| `GITHUB_WEBHOOK_SECRET` | Yes | GitHub Webhook 署名検証用 Secret |
| `ANTHROPIC_API_KEY` | Yes | Claude API キー |
| `DISCORD_WEBHOOK_URL` | Yes | Discord Webhook URL |
| `NOTIFY_API_TOKEN` | Yes | `/api/notify`, `/api/sync-webhooks` 認証用 Bearer Token |
| `GITHUB_TOKEN` | No | 失敗 job/step 詳細取得 + Webhook 同期用 (Fine-grained PAT, actions:read, administration:write) |
| `WEBHOOK_URL` | No | Webhook 同期先 URL (例: `https://workers.example.com/webhook`) |
| `ALLOWED_OWNER` | No | 許可する GitHub アカウント/Organization 名 (カンマ区切り複数可) |
| `DISCORD_PUBLIC_KEY` | Yes (`/alive`) | Discord Application Public Key. InteractionsのEd25519署名検証に使用 |
| `DISCORD_APPLICATION_ID` | Yes (`/alive`) | deferred responseの編集先を構成するApplication ID |
| `DISCORD_ALLOWED_GUILD_IDS` | Yes (`/alive`) | `/alive`を許可するguild ID (カンマ区切り) |
| `DISCORD_ALLOWED_USER_IDS` | Yes (`/alive`) | `/alive`を許可するuser ID (カンマ区切り) |
| `VAULTWARDEN_HEALTH_URL` | Yes (`/alive`) | 公開Vaultwarden health URL。例: `https://vault.example.com/alive` |

## Discord `/alive` のセットアップ

1. Discord Developer PortalでApplicationを作成し, **Interactions Endpoint URL** に`https://workers.example.com/discord/interactions`を設定する. PINGに署名付きで応答できることをPortal上で確認する.
2. ApplicationのPublic Keyと, allowlistに使うguild/user IDをWorker secretとして設定する. allowlistは空でも全許可にはならず, 常にdenyする.
3. Bot TokenをWorkerへ登録せず, ローカルまたはCIのsecretとしてだけ渡してguild commandを登録する. guild commandは即時反映される.

   ```bash
   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... DISCORD_COMMAND_GUILD_ID=... \
     bun run register-discord-commands
   ```

4. allowlistに入ったguild/userで`/alive`を実行し, ephemeralな結果にHTTP status, latency, checked time, public targetが表示されることを確認する. 署名なしまたは不正なrequestは`401`になる.

`/alive`はオンデマンドの公開経路診断であり, 継続監視ではない. WorkerまたはDiscord自体が停止している場合には応答できず, PVEやLXCの内部状態を確認・再起動する権限も持たない. 自動復旧はVaultwarden側watchdogの責務である.

## Development

| コマンド | 説明 |
| ---------- | ------ |
| `bun run dev` | 開発サーバー起動 |
| `bun run test -- --run` | Workers向けVitest実行 |
| `bun run test:cli` | CLI向けVitest実行 |
| `bun run test -- --watch` | watch モード |
| `bunx tsc --noEmit` | 型チェック |
| `bun run deploy` | デプロイ |

## Architecture

```text
src/
├── index.ts       # Workers エントリーポイント (fetch handler)
├── types.ts       # 型定義 (Env, GitHubErrorInfo, WebhookSyncResult, Discord 関連)
├── github.ts      # GitHub Webhook 署名検証 & ペイロード解析
├── github-api.ts  # GitHub API (失敗 job/step 取得)
├── claude.ts      # Claude API 統合 (ホロ口調変換)
├── discord.ts     # Discord Webhook 送信
├── discord-interactions.ts # Discord Interactions署名検証・認可
├── health.ts      # Vaultwarden公開health確認
├── history.ts     # Workers KV 履歴管理
└── webhook-sync.ts # 全リポジトリ Webhook 一括同期 (GitHub API)
```

### Request Flow (POST /webhook)

1. GitHub Webhook 受信
2. HMAC-SHA256 署名検証
3. オーナー検証 (`ALLOWED_OWNER` 設定時)
4. アーカイブ済みリポジトリはスキップ
5. ペイロード解析 → `GitHubErrorInfo` 抽出
6. 失敗時: GitHub API で失敗 job/step 取得 (`GITHUB_TOKEN` 設定時)
7. KV から口調履歴読み込み
8. Claude API でホロ口調変換 (エラー詳細付き)
9. Discord Embed 送信 + 履歴保存 (`waitUntil`)

### Request Flow (POST /api/sync-webhooks)

1. Bearer Token 認証 (`NOTIFY_API_TOKEN`)
2. `GITHUB_TOKEN`, `WEBHOOK_URL` 存在チェック
3. 全リポジトリ取得 (GitHub API、ページネーション対応)
4. 並列度 5 で Webhook 同期 (作成/スキップ/アーカイブ済み削除)
5. rate limit 検出時は早期打ち切り、partial result 返却

### Request Flow (POST /discord/interactions)

1. `X-Signature-Ed25519` と `X-Signature-Timestamp` で、raw bodyをEd25519検証
2. PING (`type: 1`) には直ちにPONGを返却
3. guild/user allowlistと`/alive` commandを確認。DM、未許可、未知commandはephemeralに拒否
4. `/alive`には3秒制約内でdeferred ephemeral ACK (`type: 5`) を返却
5. `waitUntil`でVaultwardenの公開health endpointだけを確認し、original responseを編集
