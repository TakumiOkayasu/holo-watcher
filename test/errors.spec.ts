import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { buildApiErrorMessage } from '../src/errors';

describe('buildApiErrorMessage', () => {
  const headers = new Headers({ 'content-type': 'application/json' });

  it('should return balance message for 402', () => {
    const error = Anthropic.APIError.generate(402, { type: 'error', error: { type: 'invalid_request_error', message: 'insufficient funds' } }, 'insufficient funds', headers);
    expect(buildApiErrorMessage(error)).toContain('残高');
  });

  it('should return rate limit message for 429', () => {
    const error = Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }, 'rate limited', headers);
    expect(buildApiErrorMessage(error)).toContain('レート制限');
  });

  it('should return API key message for 401', () => {
    const error = Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid key' } }, 'invalid key', headers);
    expect(buildApiErrorMessage(error)).toContain('APIキー');
  });

  it('should return overload message for 529', () => {
    const error = Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }, 'overloaded', headers);
    expect(buildApiErrorMessage(error)).toContain('過負荷');
  });

  it('should return generic API error for unknown status', () => {
    const error = Anthropic.APIError.generate(503, { type: 'error', error: { type: 'api_error', message: 'service unavailable' } }, 'service unavailable', headers);
    const msg = buildApiErrorMessage(error);
    expect(msg).toContain('Claude APIエラー (HTTP 503)');
    expect(msg).toContain('service unavailable');
  });

  it('should handle non-APIError Error', () => {
    const error = new Error('network timeout');
    expect(buildApiErrorMessage(error)).toBe('Claude APIエラー: network timeout');
  });

  it('should handle non-Error value', () => {
    expect(buildApiErrorMessage('something went wrong')).toBe('Claude APIエラー: 不明なエラー');
  });
});
