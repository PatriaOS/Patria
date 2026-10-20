// SECURITY REVIEW REQUIRED
import { bytesToHex } from '@noble/hashes/utils.js';
import { getRandomValues } from 'expo-crypto';

export const KEY_BYTES = 32;
export const XCHACHA_NONCE_BYTES = 24;

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error('invalid random length');
  }
  const out = new Uint8Array(length);
  const chunk = 1024;
  for (let offset = 0; offset < length; offset += chunk) {
    const end = Math.min(offset + chunk, length);
    getRandomValues(out.subarray(offset, end));
  }
  return out;
}

export function randomKey32(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function randomNonce24(): Uint8Array {
  return randomBytes(XCHACHA_NONCE_BYTES);
}

export function randomUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
