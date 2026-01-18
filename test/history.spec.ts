import { describe, it, expect, vi } from 'vitest';
import { loadHistory, saveHistory } from '../src/history';

describe('History (KV)', () => {
  const createMockKV = () => ({
    get: vi.fn(),
    put: vi.fn(),
  });

  describe('loadHistory', () => {
    it('should return empty array when no history', async () => {
      const kv = createMockKV();
      kv.get.mockResolvedValue(null);

      const result = await loadHistory(kv as unknown as KVNamespace);

      expect(result).toEqual([]);
    });

    it('should return stored history', async () => {
      const kv = createMockKV();
      const history = ['心配そうに伝える', '茶化し気味に伝える'];
      kv.get.mockResolvedValue(history);

      const result = await loadHistory(kv as unknown as KVNamespace);

      expect(result).toEqual(history);
    });

    it('should return empty array on error', async () => {
      const kv = createMockKV();
      kv.get.mockRejectedValue(new Error('KV error'));

      const result = await loadHistory(kv as unknown as KVNamespace);

      expect(result).toEqual([]);
    });
  });

  describe('saveHistory', () => {
    it('should save history to KV', async () => {
      const kv = createMockKV();
      const history = ['心配そうに伝える'];

      await saveHistory(kv as unknown as KVNamespace, history);

      expect(kv.put).toHaveBeenCalledWith('tone_history', JSON.stringify(history));
    });

    it('should keep only last 5 items', async () => {
      const kv = createMockKV();
      const history = ['1', '2', '3', '4', '5', '6', '7'];

      await saveHistory(kv as unknown as KVNamespace, history);

      expect(kv.put).toHaveBeenCalledWith('tone_history', JSON.stringify(['3', '4', '5', '6', '7']));
    });
  });
});
