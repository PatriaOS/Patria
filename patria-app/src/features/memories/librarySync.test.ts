import { shouldKeepSharing } from './librarySync';

describe('shouldKeepSharing', () => {
  it('keeps going unless the current sync was cancelled', () => {
    expect(shouldKeepSharing()).toBe(true);
    expect(shouldKeepSharing(() => true)).toBe(true);
    expect(shouldKeepSharing(() => false)).toBe(false);
  });
});
