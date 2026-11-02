// SECURITY REVIEW REQUIRED
// Per-member X25519 "letterbox" key: authors seal shareR to the public half;
// the private half is wrapped to the member's symmetric personal key (D34), so
// it reaches every approved phone and survives recovery without exposing device keys.
import { decryptXChaCha20Poly1305Raw, encryptXChaCha20Poly1305Raw } from './aead';
import {
  concatBytes,
  encodeUtf8Prefixed,
  requireLength,
  utf8ToBytes,
  wipe,
} from './bytes';
import { KEY_BYTES, XCHACHA_NONCE_BYTES, randomNonce24 } from './random';
import { generateDeviceKeyPair, type DeviceKeyPair } from './x25519';

const LETTERBOX_PRIVATE_CONTEXT = utf8ToBytes('patria/letterbox-private/v1');
export const LETTERBOX_WRAPPED_PRIVATE_BYTES = 48;

export type LetterboxPrivateAad = {
  familySpaceId: string;
  userId: string;
};

export function encodeLetterboxPrivateAad(aad: LetterboxPrivateAad): Uint8Array {
  return concatBytes(
    LETTERBOX_PRIVATE_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.userId),
  );
}

export function generateLetterboxKeyPair(): DeviceKeyPair {
  return generateDeviceKeyPair();
}

export function wrapLetterboxPrivateKey(
  personalKey: Uint8Array,
  letterboxPrivate: Uint8Array,
  aad: LetterboxPrivateAad,
  nonce: Uint8Array = randomNonce24(),
): { nonce: Uint8Array; wrappedPrivate: Uint8Array } {
  requireLength(personalKey, KEY_BYTES);
  requireLength(letterboxPrivate, KEY_BYTES);
  const wrappedPrivate = encryptXChaCha20Poly1305Raw(
    personalKey,
    nonce,
    letterboxPrivate,
    encodeLetterboxPrivateAad(aad),
  );
  requireLength(wrappedPrivate, LETTERBOX_WRAPPED_PRIVATE_BYTES);
  return { nonce, wrappedPrivate };
}

export function unwrapLetterboxPrivateKey(
  personalKey: Uint8Array,
  nonce: Uint8Array,
  wrappedPrivate: Uint8Array,
  aad: LetterboxPrivateAad,
): Uint8Array {
  requireLength(personalKey, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  requireLength(wrappedPrivate, LETTERBOX_WRAPPED_PRIVATE_BYTES);
  return decryptXChaCha20Poly1305Raw(
    personalKey,
    nonce,
    wrappedPrivate,
    encodeLetterboxPrivateAad(aad),
  );
}

/** Mint a letterbox pair and wrap the private half to the personal key. */
export function mintLetterboxForPersonalKey(
  personalKey: Uint8Array,
  aad: LetterboxPrivateAad,
): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  nonce: Uint8Array;
  wrappedPrivate: Uint8Array;
} {
  const pair = generateLetterboxKeyPair();
  try {
    const wrapped = wrapLetterboxPrivateKey(personalKey, pair.privateKey, aad);
    return {
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      nonce: wrapped.nonce,
      wrappedPrivate: wrapped.wrappedPrivate,
    };
  } catch (error) {
    wipe(pair.privateKey);
    wipe(pair.publicKey);
    throw error;
  }
}
