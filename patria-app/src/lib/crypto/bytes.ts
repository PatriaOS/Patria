// SECURITY REVIEW REQUIRED
import { equalBytes } from '@noble/ciphers/utils.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { concatBytes, utf8ToBytes };

export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function secretsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return equalBytes(a, b);
}

export function requireLength(bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) {
    throw new Error('invalid length');
  }
}

export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('invalid u32');
  }
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

export function readU32be(bytes: Uint8Array, offset = 0): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new Error('invalid length');
  }
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

export function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0xffff) {
    throw new Error('invalid length');
  }
  const header = new Uint8Array(2);
  header[0] = (bytes.length >> 8) & 0xff;
  header[1] = bytes.length & 0xff;
  return concatBytes(header, bytes);
}

export function encodeUtf8Prefixed(value: string): Uint8Array {
  return lengthPrefixed(utf8ToBytes(value));
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}
