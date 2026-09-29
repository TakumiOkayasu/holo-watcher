import Anthropic from '@anthropic-ai/sdk';
import { TextGenerationError, type TextGenerator } from '../text-generation';

export function createAnthropicGenerator(config: {
  apiKey: string;
  model: string;
}): TextGenerator {
  const client = new Anthropic({ apiKey: config.apiKey });
  return {
    async generate(prompt) {
      try {
        const response = await client.messages.create({
          model: config.model,
          max_tokens: 600,
          temperature: 0.8,
          messages: [{ role: 'user', content: prompt }],
        });
        return response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new TextGenerationError(error.message, error.status);
        }
        throw new TextGenerationError(error instanceof Error ? error.message : 'Unknown error');
      }
    },
  };
}
