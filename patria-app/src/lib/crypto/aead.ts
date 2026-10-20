// SECURITY REVIEW REQUIRED
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, requireLength, wipe } from './bytes';
import { KEY_BYTES, XCHACHA_NONCE_BYTES, randomNonce24 } from './random';

export const AEAD_VERSION = 1;
const TAG_BYTES = 16;

export function sealXChaCha20Poly1305(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
  nonce: Uint8Array = randomNonce24(),
): Uint8Array {
  requireLength(key, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, aad);
  const ciphertext = cipher.encrypt(plaintext);
  return concatBytes(new Uint8Array([AEAD_VERSION]), nonce, ciphertext);
}

export function openXChaCha20Poly1305(
  key: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  requireLength(key, KEY_BYTES);
  if (sealed.length < 1 + XCHACHA_NONCE_BYTES + TAG_BYTES) {
    throw new Error('unwrap failed');
  }
  if (sealed[0] !== AEAD_VERSION) {
    throw new Error('unwrap failed');
  }
  const nonce = sealed.subarray(1, 1 + XCHACHA_NONCE_BYTES);
  const ciphertext = sealed.subarray(1 + XCHACHA_NONCE_BYTES);
  try {
    const cipher = xchacha20poly1305(key, nonce, aad);
    return cipher.decrypt(ciphertext);
  } catch {
    throw new Error('unwrap failed');
  }
}

export function encryptXChaCha20Poly1305Raw(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  requireLength(key, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, aad);
  return cipher.encrypt(plaintext);
}

export function decryptXChaCha20Poly1305Raw(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextAndTag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  requireLength(key, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  try {
    const cipher = xchacha20poly1305(key, nonce, aad);
    return cipher.decrypt(ciphertextAndTag);
  } catch {
    throw new Error('unwrap failed');
  }
}

export function wipeKey(key: Uint8Array): void {
  wipe(key);
}
