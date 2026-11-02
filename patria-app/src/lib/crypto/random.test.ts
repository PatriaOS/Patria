// @ts-nocheck
import { readFileSync } from 'fs';
import { join } from 'path';

import { bytesToHex } from '@noble/hashes/utils.js';

import { KEY_BYTES, randomBytes, randomKey32, randomUuid } from './random';

describe('random bytes', () => {
  it('fills the requested length from expo-crypto, not an insecure PRNG', () => {
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

  it('wires globalThis.crypto.getRandomValues to expo-crypto', () => {
    const source = readFileSync(join(__dirname, 'random.ts'), 'utf8');
    expect(source).toMatch(/import\s*\{\s*getRandomValues\s*\}\s*from\s*'expo-crypto'/);
    expect(source).toMatch(/cryptoObj\.getRandomValues\s*=/);
    expect(source).toMatch(/getRandomValues\(arr\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(typeof globalThis.crypto?.getRandomValues).toBe('function');
    const viaGlobal = new Uint8Array(16);
    expect(() => globalThis.crypto.getRandomValues(viaGlobal)).not.toThrow();
    expect(randomBytes(8)).toHaveLength(8);
  });

  it('fails if crypto.getRandomValues is missing after the polyfill module loads', () => {
    jest.isolateModules(() => {
      const g = globalThis as { crypto?: Crypto };
      const previous = g.crypto;
      // Simulate Hermes: no Web Crypto on the global.
      g.crypto = undefined;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./random');
      expect(globalThis.crypto).toBeDefined();
      expect(typeof globalThis.crypto.getRandomValues).toBe('function');
      const buf = new Uint8Array(8);
      expect(() => globalThis.crypto.getRandomValues(buf)).not.toThrow();
      g.crypto = previous;
    });
  });
});
