import { isDesignPreviewRuntime, isLocalOrE2eRuntime } from '../../lib/localOrE2eRuntime';

/**
 * Design preview routes must never open against hosted (Expo Go is always
 * __DEV__). Local Supabase URL only; e2e always uses a local URL.
 */
describe('design preview gate', () => {
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

  it('refuses design shortcuts against hosted even when __DEV__ is true', () => {
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_E2E;
    try {
      expect(isDesignPreviewRuntime('https://example.supabase.co')).toBe(false);
      expect(isLocalOrE2eRuntime('https://example.supabase.co')).toBe(false);
    } finally {
      if (previous === undefined) {
        delete g.__DEV__;
      } else {
        g.__DEV__ = previous;
      }
    }
  });

  it('allows design shortcuts only on a local Supabase URL', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(isDesignPreviewRuntime('http://127.0.0.1:54321')).toBe(true);
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(isDesignPreviewRuntime('http://127.0.0.1:54321')).toBe(true);
    expect(isDesignPreviewRuntime('https://example.supabase.co')).toBe(false);
  });

  it('keeps letter-release e2e gate separate (E2E may allow hosted URL)', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(isLocalOrE2eRuntime('https://example.supabase.co')).toBe(true);
  });
});
