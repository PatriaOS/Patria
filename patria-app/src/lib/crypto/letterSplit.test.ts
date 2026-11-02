import { combineLetterCek, splitLetterCek, wipeLetterShares } from './letterSplit';
import { randomKey32 } from './random';
import { secretsEqual } from './bytes';

describe('letterSplit', () => {
  it('round-trips a CEK and leaves each share unusable alone', () => {
    const cek = randomKey32();
    const shares = splitLetterCek(cek);
    expect(secretsEqual(combineLetterCek(shares.shareR, shares.shareP), cek)).toBe(true);
    expect(secretsEqual(shares.shareR, cek)).toBe(false);
    expect(secretsEqual(shares.shareP, cek)).toBe(false);
    wipeLetterShares(shares);
  });
});
