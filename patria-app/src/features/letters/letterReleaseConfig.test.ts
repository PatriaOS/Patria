import { p256 } from '@noble/curves/nist.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX,
  getLetterReleasePublicKey,
  isFakeLetterReleasePublicKeyHex,
  letterReleaseReadyForSealing,
} from './letterReleaseConfig';

function otherValidPublicKeyHex(): string {
  const privateKey = p256.utils.randomSecretKey();
  return bytesToHex(p256.getPublicKey(privateKey, true));
}

describe('letterReleaseConfig hosted safety', () => {
  const realEnv = process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX;
  const realE2e = process.env.EXPO_PUBLIC_E2E;

  afterEach(() => {
    if (realEnv === undefined) {
      delete process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX;
    } else {
      process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX = realEnv;
    }
    if (realE2e === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = realE2e;
    }
  });

  it('recognises the known fake public key', () => {
    expect(isFakeLetterReleasePublicKeyHex(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX)).toBe(true);
    expect(isFakeLetterReleasePublicKeyHex(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX.toUpperCase())).toBe(
      true,
    );
    expect(isFakeLetterReleasePublicKeyHex('03aabb')).toBe(false);
    expect(isFakeLetterReleasePublicKeyHex(undefined)).toBe(false);
  });

  it('refuses missing or fake key when production-like (no e2e, __DEV__ false)', () => {
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_E2E;
    try {
      expect(letterReleaseReadyForSealing(undefined)).toBe(false);
      expect(letterReleaseReadyForSealing(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX)).toBe(false);
      expect(() => getLetterReleasePublicKey(undefined)).toThrow(/missing/);
      expect(() => getLetterReleasePublicKey(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX)).toThrow(
        /not configured for hosted/,
      );
    } finally {
      if (previous === undefined) {
        delete g.__DEV__;
      } else {
        g.__DEV__ = previous;
      }
    }
  });

  it('allows sealing with a real non-fake public key even when not in e2e', () => {
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_E2E;
    const realHex = otherValidPublicKeyHex();
    expect(isFakeLetterReleasePublicKeyHex(realHex)).toBe(false);
    try {
      expect(letterReleaseReadyForSealing(realHex)).toBe(true);
      expect(bytesToHex(getLetterReleasePublicKey(realHex))).toBe(realHex);
    } finally {
      if (previous === undefined) {
        delete g.__DEV__;
      } else {
        g.__DEV__ = previous;
      }
    }
  });

  it('allows the fake key under EXPO_PUBLIC_E2E=1', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(letterReleaseReadyForSealing(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX)).toBe(true);
    expect(() => getLetterReleasePublicKey(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX)).not.toThrow();
  });
});
