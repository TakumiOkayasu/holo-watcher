import { describe, it, expect } from 'vitest';
import { TextGenerationError } from '../src/text-generation';
import { buildApiErrorMessage } from '../src/errors';

describe('buildApiErrorMessage', () => {

  it('should return balance message for 402', () => {
    const error = new TextGenerationError('insufficient funds', 402);
    expect(buildApiErrorMessage(error)).toContain('残高');
  });

  it('should return rate limit message for 429', () => {
    const error = new TextGenerationError('rate limited', 429);
    expect(buildApiErrorMessage(error)).toContain('レート制限');
  });

  it('should return API key message for 401', () => {
    const error = new TextGenerationError('invalid key', 401);
    expect(buildApiErrorMessage(error)).toContain('APIキー');
  });

  it('should return overload message for 529', () => {
    const error = new TextGenerationError('overloaded', 529);
    expect(buildApiErrorMessage(error)).toContain('過負荷');
  });

  it('should return generic API error for unknown status', () => {
    const error = new TextGenerationError('service unavailable', 503);
    const msg = buildApiErrorMessage(error);
    expect(msg).toContain('テキスト生成APIエラー (HTTP 503)');
    expect(msg).toContain('service unavailable');
  });

  it('should handle non-APIError Error', () => {
    const error = new Error('network timeout');
    expect(buildApiErrorMessage(error)).toBe('テキスト生成APIエラー: network timeout');
  });

  it('should handle non-Error value', () => {
    expect(buildApiErrorMessage('something went wrong')).toBe('テキスト生成APIエラー: 不明なエラー');
  });
});
