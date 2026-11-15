import { z } from 'zod';
import { version as zodVersion } from 'zod/package.json';

/**
 * GHSA-mrhx-c7xc-m3w5: zod < 4.6.6 can exhaust memory while validating
 * oversized constrained collections. Patched floor is 4.6.6.
 */
describe('zod patched for GHSA-mrhx-c7xc-m3w5', () => {
  it('resolves the app dependency at 4.6.6 or newer', () => {
    const [major, minor, patch] = zodVersion.split('.').map((part) => Number(part));
    expect(major).toBeGreaterThanOrEqual(4);
    if (major === 4) {
      expect(minor).toBeGreaterThanOrEqual(6);
      if (minor === 6) {
        expect(patch).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('rejects an oversized max() array with a single too_big issue', () => {
    const schema = z.array(z.string()).max(10);
    const result = schema.safeParse(Array(5_000).fill('x'));
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.code).toBe('too_big');
  });
});
