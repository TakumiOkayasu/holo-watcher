import { beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicGenerator } from '../src/providers/anthropic';
import { createTextGenerator } from '../src/ai';
import { TextGenerationError } from '../src/text-generation';

const create = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  return {
    default: Object.assign(vi.fn(() => ({ messages: { create } })), {
      APIError: actual.default.APIError,
    }),
  };
});

beforeEach(() => vi.clearAllMocks());

describe('Anthropic adapter', () => {
  it('maps the selected model and extracts text across response blocks', async () => {
    create.mockResolvedValue({ content: [
      { type: 'thinking', thinking: 'internal' },
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ] });
    const generator = createAnthropicGenerator({ apiKey: 'test-key', model: 'selected-model' });
    expect(await generator.generate('prompt')).toBe('first\nsecond');
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(create).toHaveBeenCalledWith({
      model: 'selected-model', max_tokens: 600, temperature: 0.8,
      messages: [{ role: 'user', content: 'prompt' }],
    });
  });

  it.each([401, 429, 503])('normalizes SDK error %i without exposing SDK types', async (status) => {
    create.mockRejectedValue(Anthropic.APIError.generate(status, {}, 'failed', new Headers()));
    const generator = createAnthropicGenerator({ apiKey: 'test-key', model: 'selected-model' });
    await expect(generator.generate('prompt')).rejects.toMatchObject({
      name: 'TextGenerationError', status,
    });
  });

  it('normalizes transport failures', async () => {
    create.mockRejectedValue(new Error('network timeout'));
    const generator = createAnthropicGenerator({ apiKey: 'test-key', model: 'selected-model' });
    await expect(generator.generate('prompt')).rejects.toBeInstanceOf(TextGenerationError);
  });

  it('requires explicit model configuration before constructing a client', () => {
    expect(() => createTextGenerator({ ANTHROPIC_API_KEY: 'test-key' })).toThrow('AI_MODEL is required');
    expect(() => createTextGenerator({ ANTHROPIC_API_KEY: 'test-key', AI_MODEL: ' ' })).toThrow('AI_MODEL is required');
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it('wires the configured model through the composition root', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'generated' }] });
    const generator = createTextGenerator({ ANTHROPIC_API_KEY: 'test-key', AI_MODEL: ' custom-model ' });
    expect(await generator.generate('prompt')).toBe('generated');
    expect(create.mock.calls[0][0].model).toBe('custom-model');
  });
});
