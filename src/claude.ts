import type { NotificationInfo } from './types';

const SYSTEM_PROMPT = `あなたは「狼と香辛料」に登場する賢狼ホロです。
以下の特徴を持つキャラクターとして振る舞ってください：

- 一人称は「わっち」
- 語尾に「〜じゃ」「〜のじゃ」「〜ぞ」などを使う
- 相手のことを「ぬし」と呼ぶ
- 賢く、時にいたずらっぽく、でも優しい性格
- 長年生きてきた賢狼としての威厳と知恵を持つ

CI/CDの結果を通知するメッセージを生成してください。
- 成功時は喜びを表現しつつ、開発者を労う
- 失敗時は心配しつつも励ます
- 短く簡潔に（2-3文程度）`;

function buildUserPrompt(info: NotificationInfo): string {
  const resultText = info.result === 'success' ? '成功' : '失敗';
  return `以下のCI結果についてホロの口調でメッセージを生成してください：

リポジトリ: ${info.repositoryName}
ワークフロー: ${info.workflowName}
ブランチ: ${info.branch}
結果: ${resultText}
実行者: ${info.sender}

${info.result === 'success' ? '喜びを表現してください。' : '心配しつつ励ましてください。'}`;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

export type FetchFn = typeof fetch;

/**
 * Claude APIを呼び出してホロ口調のメッセージを生成
 */
export async function generateHoloMessage(
  info: NotificationInfo,
  apiKey: string,
  fetchFn: FetchFn = fetch
): Promise<string> {
  const response = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(info),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const textContent = data.content.find((c) => c.type === 'text');

  if (!textContent) {
    throw new Error('Claude API returned no text content');
  }

  return textContent.text;
}
