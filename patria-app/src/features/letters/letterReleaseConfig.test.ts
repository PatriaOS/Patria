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

const HOSTED_URL = 'https://olcfghdmsgdnfvglxddh.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';

describe('letterReleaseConfig hosted safety', () => {
  const realEnv = process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX;
  const realE2e = process.env.EXPO_PUBLIC_E2E;
  const realUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

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
    if (realUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SUPABASE_URL = realUrl;
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

  it('refuses missing or fake key against a hosted Supabase URL (Expo Go / __DEV__ case)', () => {
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_E2E;
    try {
      expect(letterReleaseReadyForSealing(undefined, HOSTED_URL)).toBe(false);
      expect(letterReleaseReadyForSealing(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX, HOSTED_URL)).toBe(
        false,
      );
      expect(() => getLetterReleasePublicKey(undefined, HOSTED_URL)).toThrow(/missing/);
      expect(() => getLetterReleasePublicKey(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX, HOSTED_URL)).toThrow(
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

  it('allows the fake key on a local Supabase URL without e2e', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(letterReleaseReadyForSealing(undefined, LOCAL_URL)).toBe(true);
    expect(letterReleaseReadyForSealing(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX, LOCAL_URL)).toBe(true);
    expect(() => getLetterReleasePublicKey(undefined, LOCAL_URL)).not.toThrow();
  });

  it('allows sealing with a real non-fake public key on hosted', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    const realHex = otherValidPublicKeyHex();
    expect(isFakeLetterReleasePublicKeyHex(realHex)).toBe(false);
    expect(letterReleaseReadyForSealing(realHex, HOSTED_URL)).toBe(true);
    expect(bytesToHex(getLetterReleasePublicKey(realHex, HOSTED_URL))).toBe(realHex);
  });

  it('allows the fake key under EXPO_PUBLIC_E2E=1 even against a hosted URL', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(letterReleaseReadyForSealing(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX, HOSTED_URL)).toBe(true);
    expect(() =>
      getLetterReleasePublicKey(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX, HOSTED_URL),
    ).not.toThrow();
  });
});
