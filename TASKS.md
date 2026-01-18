# 【Claude Code での実装タスク - 最新版】

## タスク概要

Cloudflare Workers上で動作する、GitHub Actions CI失敗通知をホロ(狼と香辛料)の口調でDiscordに送信するサーバーレスBot

## 前提条件

- プロジェクト: `~/prog/holo-ci-workers`
- 構成ファイル: `wrangler.jsonc` (TOML形式ではない)
- エントリーポイント: `src/index.ts` (既存)
- パッケージマネージャ: bun

---

## タスク1: 依存関係追加

### 目的

Anthropic SDK追加

### 具体的手順

```bash
cd ~/prog/holo-ci-workers
bun add @anthropic-ai/sdk
```

### 完了条件

- `package.json`の`dependencies`に`@anthropic-ai/sdk`が追加されている

---

## タスク2: ディレクトリ構成作成

### 目的

モジュール分割による保守性向上

### 具体的手順

以下のファイルを`src/`配下に作成:

```
src/
├── index.ts              # 既存(後で上書き)
├── types.ts              # 型定義
├── github.ts             # GitHub Webhook処理
├── claude.ts             # Claude API統合
├── discord.ts            # Discord送信
└── history.ts            # 履歴管理(Workers KV)
```

### 注意点

- 既存の`src/index.ts`は後で上書きする

---

## タスク3: 型定義実装

### 目的

TypeScript型安全性確保

### ファイル: `src/types.ts`

```typescript
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
  embeds: DiscordEmbed[];
}
```

---

## タスク4: GitHub Webhook処理実装

### 目的

GitHub Actionsからのペイロードを解析し、HMAC-SHA256署名検証を行う

### ファイル: `src/github.ts`

```typescript
import type { GitHubErrorInfo } from './types';

/**
 * GitHub Webhook署名検証(HMAC-SHA256)
 * @param signature リクエストヘッダーのX-Hub-Signature-256
 * @param body リクエストボディ(文字列)
 * @param secret Webhook Secret
 * @returns 検証結果
 */
export async function verifyGitHubSignature(
  signature: string,
  body: string,
  secret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(body);

  try {
    // Web Crypto APIでHMACキーをインポート
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 署名のhex文字列をバイト列に変換
    const signatureHex = signature.replace('sha256=', '');
    const signatureBytes = hexToBytes(signatureHex);

    // HMAC検証(constant-time比較)
    return await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, data);
  } catch {
    return false;
  }
}

/**
 * hex文字列をUint8Arrayに変換
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * GitHub Webhookペイロードを解析してCI失敗情報を抽出
 * @param payload GitHubからのWebhookペイロード
 * @returns CI失敗情報(失敗でない場合はnull)
 */
export function parseWebhook(payload: any): GitHubErrorInfo | null {
  // workflow_run イベントの completed アクションのみ処理
  if (payload.action !== 'completed') {
    return null;
  }

  const run = payload.workflow_run;
  if (!run || run.conclusion !== 'failure') {
    return null;
  }

  // 失敗情報を抽出
  return {
    repo: payload.repository.full_name,
    workflow: run.name,
    branch: run.head_branch,
    commit: run.head_sha,
    commitMsg: run.head_commit?.message || '',
    url: run.html_url,
    author: run.head_commit?.author?.name || 'Unknown',
  };
}
```

### 注意点

- Web Crypto APIを使用(Node.jsのcryptoモジュールは使えない)
- constant-time比較でタイミング攻撃を防ぐ
- 署名はsha256=プレフィックス付きhex文字列

---

## タスク5: Claude API統合実装

### 目的

CI失敗メッセージをホロの口調に変換し、毎回異なる口調パターンを使用

### ファイル: `src/claude.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { GitHubErrorInfo } from './types';

/**
 * ホロの口調バリエーション(8パターン)
 */
const TONE_PATTERNS = [
  '心配そうに伝える',
  '茶化し気味に伝える',
  '励まし調で伝える',
  '淡々と事実を述べる',
  '呆れ気味に伝える',
  '分析的に伝える',
  '驚いた様子で伝える',
  '同情的に伝える',
] as const;

/**
 * CI失敗情報をホロの口調に変換
 * @param errorInfo CI失敗情報
 * @param history 最近使った口調の履歴(最大5件)
 * @param apiKey Anthropic API Key
 * @returns ホロ口調のメッセージ
 */
export async function convertToHolo(
  errorInfo: GitHubErrorInfo,
  history: string[],
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  // 最近使っていない口調を選択
  const availableTones = TONE_PATTERNS.filter((tone) => !history.includes(tone));
  const selectedTone =
    availableTones.length > 0
      ? availableTones[Math.floor(Math.random() * availableTones.length)]
      : TONE_PATTERNS[Math.floor(Math.random() * TONE_PATTERNS.length)];

  // 履歴を文字列化
  const recentList = history.length > 0 ? history.map((h) => `- ${h}`).join('\n') : '(初回)';

  // プロンプト構築
  const prompt = `以下のCI失敗情報を日本語に翻訳し、「狼と香辛料」のホロの口調で伝えてください。

【ホロの特徴】
- 一人称: わっち
- 二人称: ぬし、おぬし
- 語尾: ~じゃ、~のう、~ぞ、~かや、~ではないかや
- 賢狼らしい知的で茶目っ気のある言い回し
- 長生きゆえの達観した物言い

【今回の口調】
${selectedTone}

【最近使った口調】(これらとは違うニュアンスで)
${recentList}

【CI失敗情報】
- リポジトリ: ${errorInfo.repo}
- ワークフロー: ${errorInfo.workflow}
- ブランチ: ${errorInfo.branch}
- コミット: ${errorInfo.commit.substring(0, 7)}
- コミットメッセージ: ${errorInfo.commitMsg.substring(0, 100)}

【変換ルール】
1. 150-250文字程度で簡潔に
2. 技術用語は適宜わかりやすく
3. 失敗の事実を伝えつつ、ホロらしさを出す
4. 変換結果のみを出力(説明不要)

【変換後】`;

  // Claude API呼び出し
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    temperature: 0.8, // 多様性を確保
    messages: [{ role: 'user', content: prompt }],
  });

  // レスポンス抽出
  const result = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

  // 履歴更新(引数の配列を直接変更)
  history.push(selectedTone);
  if (history.length > 5) {
    history.shift(); // 古いものを削除
  }

  return result;
}
```

### 注意点

- temperature: 0.8で多様性を確保
- 履歴は配列を直接変更(参照渡し)
- 最近使った口調を避けるロジック

---

## タスク6: Discord送信実装

### 目的

整形されたメッセージをDiscord Webhookで送信

### ファイル: `src/discord.ts`

```typescript
import type { GitHubErrorInfo, DiscordWebhookPayload } from './types';

/**
 * ホロ口調メッセージをDiscordに送信
 * @param message ホロ口調化されたメッセージ
 * @param errorInfo CI失敗情報
 * @param webhookUrl Discord Webhook URL
 */
export async function sendToDiscord(
  message: string,
  errorInfo: GitHubErrorInfo,
  webhookUrl: string
): Promise<void> {
  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '🐺 CI失敗のお知らせじゃ',
        description: message,
        color: 0xed4245, // 赤色
        fields: [
          { name: '📦 リポジトリ', value: errorInfo.repo, inline: true },
          { name: '🌿 ブランチ', value: errorInfo.branch, inline: true },
          { name: '👤 作者', value: errorInfo.author, inline: true },
          {
            name: '💬 コミット',
            value: errorInfo.commitMsg.substring(0, 100),
            inline: false,
          },
        ],
        footer: { text: `Commit: ${errorInfo.commit.substring(0, 7)}` },
        url: errorInfo.url,
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status}`);
  }
}
```

### 注意点

- Embedで綺麗に整形
- エラーハンドリング

---

## タスク7: 履歴管理実装

### 目的

Workers KVで口調履歴を永続化

### ファイル: `src/history.ts`

```typescript
/**
 * KV保存キー
 */
const HISTORY_KEY = 'tone_history';

/**
 * Workers KVから口調履歴を読み込み
 * @param kv KVNamespace
 * @returns 履歴配列(最大5件)
 */
export async function loadHistory(kv: KVNamespace): Promise<string[]> {
  try {
    const stored = await kv.get(HISTORY_KEY, 'json');
    return Array.isArray(stored) ? stored : [];
  } catch {
    // KV読み込み失敗時は空配列
    return [];
  }
}

/**
 * Workers KVに口調履歴を保存
 * @param kv KVNamespace
 * @param history 履歴配列
 */
export async function saveHistory(kv: KVNamespace, history: string[]): Promise<void> {
  // 最新5件のみ保持
  const toSave = history.slice(-5);
  await kv.put(HISTORY_KEY, JSON.stringify(toSave));
}
```

### 注意点

- KV読み込み失敗時はエラーを投げず空配列を返す
- 最新5件のみ保持

---

## タスク8: メインハンドラー実装

### 目的

全モジュールを統合し、HTTPリクエストを処理

### ファイル: `src/index.ts` (既存を上書き)

```typescript
import type { Env } from './types';
import { verifyGitHubSignature, parseWebhook } from './github';
import { convertToHolo } from './claude';
import { sendToDiscord } from './discord';
import { loadHistory, saveHistory } from './history';

/**
 * Cloudflare Workers エントリーポイント
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS対応(プリフライトリクエスト)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature-256',
        },
      });
    }

    const url = new URL(request.url);

    // ルーティング
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, ctx);
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'holo-ci-bot',
          message: 'わっちは元気じゃぞ!',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * GitHub Webhook処理ハンドラー
 */
async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // 1. リクエストボディ取得
    const body = await request.text();
    const signature = request.headers.get('X-Hub-Signature-256');

    // 2. 署名検証
    if (!signature || !(await verifyGitHubSignature(signature, body, env.GITHUB_WEBHOOK_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 3. ペイロード解析
    const payload = JSON.parse(body);
    const errorInfo = parseWebhook(payload);

    if (!errorInfo) {
      // 失敗イベントでない場合はスキップ
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not a failure event' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. 履歴読み込み
    const history = await loadHistory(env.HOLO_HISTORY);

    // 5. ホロ口調化
    const holoMessage = await convertToHolo(errorInfo, history, env.ANTHROPIC_API_KEY);

    // 6. Discord送信(非同期で実行、レスポンスを待たない)
    ctx.waitUntil(sendToDiscord(holoMessage, errorInfo, env.DISCORD_WEBHOOK_URL));

    // 7. 履歴保存(非同期)
    ctx.waitUntil(saveHistory(env.HOLO_HISTORY, history));

    // 8. 即座にレスポンス返却
    return new Response(
      JSON.stringify({
        status: 'success',
        preview: holoMessage.substring(0, 50) + '...',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
```

### 注意点

- `ExecutionContext.waitUntil`で非同期処理を登録
- レスポンスは即座に返却(Discord送信完了を待たない)
- エラーハンドリング

---

## タスク9: 設定ファイル更新

### 目的

Workers KV設定とドキュメント整備

### ファイル: `wrangler.jsonc` (既存を更新)

既存の`wrangler.jsonc`に以下を追加:

```jsonc
{
 "$schema": "node_modules/wrangler/config-schema.json",
 "name": "holo-ci-workers",
 "main": "src/index.ts",
 "compatibility_date": "2025-09-27",
 "observability": {
  "enabled": true
 },
 /**
  * KV Namespaces
  * 口調履歴保存用
  * IDは後でwranglerコマンドで生成したものに置き換える
  */
 "kv_namespaces": [
  {
   "binding": "HOLO_HISTORY",
   "id": "YOUR_KV_ID_HERE",
   "preview_id": "YOUR_PREVIEW_KV_ID_HERE"
  }
 ]
 /**
  * Routes (本番デプロイ時に設定)
  * https://developers.cloudflare.com/workers/configuration/routing/routes/
  */
 // "routes": [
 //   { "pattern": "workers.murata-lab.net/*", "zone_name": "murata-lab.net" }
 // ]
}
```

### ファイル: `.env.example` (新規作成)

```bash
# GitHub Webhook Secret
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here

# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Discord Webhook URL
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxx/xxxxx
```

### ファイル: `README.md` (既存を更新)

```markdown
# 🐺 Holo CI Bot

GitHub Actions CI失敗通知を「狼と香辛料」のホロの口調でDiscordに送信するサーバーレスBot

## 特徴

- ✅ Cloudflare Workers(サーバーレス)
- ✅ 毎回異なる口調パターン(8種類)
- ✅ Workers KVで履歴管理
- ✅ Claude API(Sonnet 4)でホロ口調化

## セットアップ

### 1. KV Namespace作成

```bash
bunx wrangler kv:namespace create "HOLO_HISTORY"
bunx wrangler kv:namespace create "HOLO_HISTORY" --preview
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

---

## タスク10: ローカルテスト準備

### 目的
型チェックと基本動作確認

### 具体的手順

```bash
# 1. 型生成
bun run cf-typegen

# 2. TypeScriptビルドチェック
bunx tsc --noEmit

# 3. 開発サーバー起動
bun run dev
```

### 完了条件

- TypeScriptエラーがない
- `bun run dev`で起動できる
- `curl http://localhost:8787/health`で応答がある

---

## 完了条件チェックリスト

実装完了後、以下を確認:

- [ ] 全ファイルが作成されている
- [ ] `@anthropic-ai/sdk`がインストールされている
- [ ] TypeScriptエラーがない(`bunx tsc --noEmit`)
- [ ] `bun run dev`で起動できる
- [ ] `/health`エンドポイントが応答する
- [ ] `wrangler.jsonc`にKV設定が追加されている
- [ ] `.env.example`が作成されている
- [ ] `README.md`が更新されている
