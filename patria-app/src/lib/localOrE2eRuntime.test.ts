import { isLocalOrE2eRuntime } from './localOrE2eRuntime';

const HOSTED_URL = 'https://olcfghdmsgdnfvglxddh.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';

describe('isLocalOrE2eRuntime', () => {
  const realE2e = process.env.EXPO_PUBLIC_E2E;
  const realUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

  afterEach(() => {
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

  it('is false for hosted even when __DEV__ is true (Expo Go case)', () => {
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_E2E;
    try {
      expect(isLocalOrE2eRuntime(HOSTED_URL)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete g.__DEV__;
      } else {
        g.__DEV__ = previous;
      }
    }
  });

  it('is true for a local Supabase URL without e2e', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(isLocalOrE2eRuntime(LOCAL_URL)).toBe(true);
  });

  it('is true under EXPO_PUBLIC_E2E=1 even against hosted', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(isLocalOrE2eRuntime(HOSTED_URL)).toBe(true);
  });
});
