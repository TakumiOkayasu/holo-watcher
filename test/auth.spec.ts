import { describe, it, expect } from 'vitest';
import { verifyBearerToken } from '../src/auth';

describe('verifyBearerToken', () => {
  const token = 'test-secret-token-12345';

  it('should accept valid Bearer token', async () => {
    const result = await verifyBearerToken(`Bearer ${token}`, token);
    expect(result).toBe(true);
  });

  it('should reject null header', async () => {
    const result = await verifyBearerToken(null, token);
    expect(result).toBe(false);
  });

  it('should reject empty header', async () => {
    const result = await verifyBearerToken('', token);
    expect(result).toBe(false);
  });

  it('should reject header without Bearer prefix', async () => {
    const result = await verifyBearerToken(token, token);
    expect(result).toBe(false);
  });

  it('should reject wrong token', async () => {
    const result = await verifyBearerToken('Bearer wrong-token', token);
    expect(result).toBe(false);
  });

  it('should reject token with different length', async () => {
    const result = await verifyBearerToken('Bearer short', token);
    expect(result).toBe(false);
  });
});
