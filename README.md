# 🐺 Holo CI Bot

GitHub Actions CI結果(成功/失敗)を「狼と香辛料」のホロの口調でDiscordに送信するサーバーレスBot

## 特徴

- ✅ Cloudflare Workers(サーバーレス)
- ✅ CI成功時は緑、失敗時は赤でDiscord通知
- ✅ 毎回異なる口調パターン(8種類)
- ✅ Workers KVで履歴管理
- ✅ Claude API(Sonnet 4)でホロ口調化

## セットアップ

### 1. KV Namespace作成

```bash
bunx wrangler kv namespace create "HOLO_HISTORY"
bunx wrangler kv namespace create "HOLO_HISTORY" --preview
```

### 2. wrangler.jsonc更新

生成されたIDを`wrangler.jsonc`の`kv_namespaces`に設定

### 3. Secret設定

```bash
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler secret put DISCORD_WEBHOOK_URL
```

### 4. ローカルテスト

```bash
bun run dev
```

### 5. デプロイ

```bash
bun run deploy
```

## 開発

```bash
# 開発サーバー
bun run dev

# テスト実行
bun test

# 型生成
bun run cf-typegen

# デプロイ
bun run deploy
```
