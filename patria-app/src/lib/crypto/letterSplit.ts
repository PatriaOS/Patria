// SECURITY REVIEW REQUIRED
import { requireLength, wipe } from './bytes';
import { KEY_BYTES, randomKey32 } from './random';

/** 2-of-2 split: shareR ⊕ shareP = CEK. Either share alone reveals nothing. */
export type LetterCekShares = {
  shareR: Uint8Array;
  shareP: Uint8Array;
};

export function splitLetterCek(cek: Uint8Array): LetterCekShares {
  requireLength(cek, KEY_BYTES);
  const shareR = randomKey32();
  const shareP = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i += 1) {
    shareP[i] = cek[i]! ^ shareR[i]!;
  }
  return { shareR, shareP };
}

export function combineLetterCek(shareR: Uint8Array, shareP: Uint8Array): Uint8Array {
  requireLength(shareR, KEY_BYTES);
  requireLength(shareP, KEY_BYTES);
  const cek = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i += 1) {
    cek[i] = shareR[i]! ^ shareP[i]!;
  }
  return cek;
}

export function wipeLetterShares(shares: LetterCekShares): void {
  wipe(shares.shareR);
  wipe(shares.shareP);
}
