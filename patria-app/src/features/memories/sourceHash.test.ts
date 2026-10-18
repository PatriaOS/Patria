import {
  sourceHashForPick,
  sourceHashFromAssetId,
  sourceHashFromOriginalBytes,
} from './sourceHash';

const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe('memory source hash', () => {
  it('uses the asset id for picker and sync when both have it', () => {
    const picker = sourceHashForPick({
      secret,
      assetId: 'PH:ABC',
      originalBytes: new Uint8Array([1, 2, 3]),
    });
    const sync = sourceHashFromAssetId(secret, 'PH:ABC');
    expect(picker).toBe(sync);
    expect(picker).not.toBe(
      sourceHashFromOriginalBytes(secret, new Uint8Array([1, 2, 3])),
    );
  });

  it('falls back to original bytes before re-encoding when there is no asset id', () => {
    const original = new Uint8Array([9, 8, 7, 6]);
    const fromPicker = sourceHashForPick({ secret, originalBytes: original });
    const fromSync = sourceHashFromOriginalBytes(secret, original);
    expect(fromPicker).toBe(fromSync);
    expect(fromPicker).not.toBe(
      sourceHashFromOriginalBytes(secret, new Uint8Array([1, 1, 1, 1])),
    );
  });
});
