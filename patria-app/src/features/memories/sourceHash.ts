// SECURITY REVIEW REQUIRED
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 60;
export const RESUMABLE_MIN_BYTES = 6 * 1024 * 1024;
export const PICK_LIMIT = 30;
export const CONFIRM_WAITING_COUNT = 20;

export function sourceHashFromAssetId(secret: Uint8Array, assetId: string): string {
  return bytesToHex(hmac(sha256, secret, new TextEncoder().encode(`id:${assetId}`)));
}

export function sourceHashFromOriginalBytes(secret: Uint8Array, bytes: Uint8Array): string {
  return bytesToHex(hmac(sha256, secret, bytes));
}

export function sourceHashForPick(input: {
  secret: Uint8Array;
  assetId?: string | null;
  originalBytes: Uint8Array;
}): string {
  if (input.assetId && input.assetId.length > 0) {
    return sourceHashFromAssetId(input.secret, input.assetId);
  }
  return sourceHashFromOriginalBytes(input.secret, input.originalBytes);
}
