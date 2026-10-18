import { bytesToHex } from '@noble/hashes/utils.js';

import { supabase } from '../../lib/supabase';
import { getOrCreateSourceKey } from './sourceKey';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('memory source key', () => {
  it('two devices racing keep one shared key and never replace it', async () => {
    let stored: string | null = null;
    let createStarted: Promise<void> | null = null;
    let releaseCreate: (() => void) | undefined;
    (supabase.rpc as jest.Mock).mockImplementation(async () => {
      if (stored) {
        return { data: stored, error: null };
      }
      if (!createStarted) {
        createStarted = new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });
        stored = `\\x${'11'.repeat(32)}`;
        await createStarted;
        return { data: stored, error: null };
      }
      await createStarted;
      return { data: stored, error: null };
    });
    const first = getOrCreateSourceKey('u1');
    const second = getOrCreateSourceKey('u1');
    await Promise.resolve();
    releaseCreate?.();
    const [a, b] = await Promise.all([first, second]);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(bytesToHex(a)).toBe('11'.repeat(32));
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
