import type { Env } from './types';
import { createAnthropicGenerator } from './providers/anthropic';
import { TextGenerationError, type TextGenerator } from './text-generation';

/** Composition root: provider selection and credentials stay out of notification logic. */
export function createTextGenerator(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'AI_MODEL'>): TextGenerator {
  const model = env.AI_MODEL?.trim();
  if (!model) throw new TextGenerationError('AI_MODEL is required');
  return createAnthropicGenerator({ apiKey: env.ANTHROPIC_API_KEY, model });
}
