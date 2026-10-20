import { bytesToHex } from '@noble/hashes/utils.js';
import { KEY_BYTES, randomBytes, randomKey32, randomUuid } from './random';

describe('random bytes', () => {
  it('fills the requested length from expo-crypto, not Math.random', () => {
    const a = randomBytes(KEY_BYTES);
    const b = randomKey32();
    expect(a).toHaveLength(KEY_BYTES);
    expect(b).toHaveLength(KEY_BYTES);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('makes a UUID without globalThis.crypto.randomUUID', () => {
    expect(randomUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(randomUuid()).not.toBe(randomUuid());
  });
});
