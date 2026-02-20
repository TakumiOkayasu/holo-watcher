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
  apiKey: string,
  errorSummary?: string
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
  const isSuccess = errorInfo.conclusion === 'success';
  const eventType = isSuccess ? 'CI成功' : 'CI失敗';
  const prompt = `以下の${eventType}情報を日本語に翻訳し、「狼と香辛料」のホロの口調で伝えてください。

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

【${eventType}情報】
- リポジトリ: ${errorInfo.repo}
- ワークフロー: ${errorInfo.workflow}
- ブランチ: ${errorInfo.branch}
- コミット: ${errorInfo.commit.substring(0, 7)}
- コミットメッセージ: ${errorInfo.commitMsg.substring(0, 100)}

${errorSummary ? `【エラー詳細】\n${errorSummary.substring(0, 800)}\n\n` : ''}【変換ルール】
1. 150-250文字程度で簡潔に
2. 技術用語は適宜わかりやすく
3. ${isSuccess ? '成功を喜びつつ' : '失敗の事実を伝えつつ'}、ホロらしさを出す
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
