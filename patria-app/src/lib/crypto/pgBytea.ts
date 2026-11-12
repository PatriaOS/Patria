// SECURITY REVIEW REQUIRED
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const X25519_PUBLIC_KEY_BYTES = 32;

function decodeHex(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') || hex.startsWith('\\X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('invalid bytea encoding');
  }
  return hexToBytes(clean);
}

function decodeBase64(value: string): Uint8Array {
  const bin = globalThis.atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function asciiFromBytes(bytes: Uint8Array): string | null {
  for (const b of bytes) {
    if (b < 32 || b > 126) {
      return null;
    }
  }
  let text = '';
  for (const b of bytes) {
    text += String.fromCharCode(b);
  }
  return text;
}

function fromArrayLike(value: Record<string, unknown>): Uint8Array {
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => /^\d+$/.test(key))) {
    throw new Error('invalid bytea encoding');
  }
  const max = Math.max(...keys.map((key) => Number(key)));
  const out = new Uint8Array(max + 1);
  for (const key of keys) {
    const n = value[key];
    if (typeof n !== 'number' || n < 0 || n > 255) {
      throw new Error('invalid bytea encoding');
    }
    out[Number(key)] = n;
  }
  return out;
}

export function toPgBytea(bytes: Uint8Array): string {
  return `\\x${bytesToHex(bytes)}`;
}

export function fromPgBytea(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    // Only re-decode when the bytes are clearly a Postgres hex text dump
    // ("\x" + hex). Do not treat raw key material that happens to be
    // printable hex charset as hex text — that false positive flips keys.
    const ascii = asciiFromBytes(value);
    if (ascii && (ascii.startsWith('\\x') || ascii.startsWith('\\X'))) {
      return decodeHex(ascii);
    }
    return value;
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromPgBytea(new Uint8Array(value));
  }
  if (Array.isArray(value)) {
    return fromPgBytea(Uint8Array.from(value));
  }
  if (value && typeof value === 'object') {
    return fromPgBytea(fromArrayLike(value as Record<string, unknown>));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      trimmed.startsWith('\\x') ||
      trimmed.startsWith('\\X') ||
      (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0)
    ) {
      return decodeHex(trimmed);
    }
    try {
      const decoded = decodeBase64(trimmed);
      if (decoded.length > 0) {
        return decoded;
      }
    } catch {
      throw new Error('invalid bytea encoding');
    }
    throw new Error('invalid bytea encoding');
  }
  throw new Error('invalid bytea encoding');
}

export function requireX25519PublicKey(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== X25519_PUBLIC_KEY_BYTES) {
    throw new Error(`invalid public key length ${bytes.length}`);
  }
  return bytes;
}
