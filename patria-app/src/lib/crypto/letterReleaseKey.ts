// SECURITY REVIEW REQUIRED
/**
 * Patria release share: ECDH with an ECC_NIST_P256 KEY_AGREEMENT public key
 * (AWS KMS on hosted; fake P-256 pair locally). No RSA.
 */
import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { openXChaCha20Poly1305, sealXChaCha20Poly1305 } from './aead';
import { concatBytes, encodeUtf8Prefixed, requireLength, u32be, utf8ToBytes, wipe } from './bytes';
import { hkdfSha256 } from './hkdf';
import { KEY_BYTES } from './random';

const SHARE_INFO_PREFIX = utf8ToBytes('patria/letter-patria-share/v1');
/** Compressed P-256 public key length from @noble/curves. */
export const P256_COMPRESSED_PUBLIC_BYTES = 33;
export const P256_SECRET_BYTES = 32;

export type LetterPatriaShareAad = {
  letterId: string;
  version: number;
};

export type SealedPatriaShare = {
  ephemeralPublicKey: Uint8Array;
  sealedShare: Uint8Array;
};

export function encodeLetterPatriaShareInfo(aad: LetterPatriaShareAad): Uint8Array {
  return concatBytes(SHARE_INFO_PREFIX, encodeUtf8Prefixed(aad.letterId), u32be(aad.version));
}

/**
 * Noble returns a compressed point (33 bytes). AWS KMS DeriveSharedSecret for
 * ECC_NIST_P256 yields the raw 32-byte x-coordinate. Strip the leading format
 * byte so local fake and hosted KMS agree.
 */
export function ecdhSharedSecretRaw(sharedFromNoble: Uint8Array): Uint8Array {
  if (sharedFromNoble.length === KEY_BYTES) {
    return sharedFromNoble.slice();
  }
  if (sharedFromNoble.length === P256_COMPRESSED_PUBLIC_BYTES) {
    return sharedFromNoble.subarray(1, 1 + KEY_BYTES).slice();
  }
  throw new Error('invalid shared secret');
}

export function derivePatriaShareWrapKey(
  sharedSecretRaw: Uint8Array,
  aad: LetterPatriaShareAad,
): Uint8Array {
  requireLength(sharedSecretRaw, KEY_BYTES);
  const info = encodeLetterPatriaShareInfo(aad);
  // Salt = empty; context is fully in info (letter id + version).
  return hkdfSha256(sharedSecretRaw, new Uint8Array(0), info, KEY_BYTES);
}

export function generateP256KeyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const pair = p256.keygen();
  return { secretKey: pair.secretKey, publicKey: pair.publicKey };
}

export function p256PublicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  requireLength(secretKey, P256_SECRET_BYTES);
  return p256.getPublicKey(secretKey, true);
}

export function sealSharePToReleasePublicKey(
  shareP: Uint8Array,
  releasePublicKey: Uint8Array,
  aad: LetterPatriaShareAad,
): SealedPatriaShare {
  requireLength(shareP, KEY_BYTES);
  requireLength(releasePublicKey, P256_COMPRESSED_PUBLIC_BYTES);
  const ephemeral = p256.keygen();
  let shared: Uint8Array | undefined;
  let raw: Uint8Array | undefined;
  let wrapKey: Uint8Array | undefined;
  try {
    shared = p256.getSharedSecret(ephemeral.secretKey, releasePublicKey);
    raw = ecdhSharedSecretRaw(shared);
    wrapKey = derivePatriaShareWrapKey(raw, aad);
    const aadBytes = encodeLetterPatriaShareInfo(aad);
    const sealedShare = sealXChaCha20Poly1305(wrapKey, shareP, aadBytes);
    return {
      ephemeralPublicKey: ephemeral.publicKey.slice(),
      sealedShare,
    };
  } finally {
    wipe(ephemeral.secretKey);
    if (shared) {
      wipe(shared);
    }
    if (raw) {
      wipe(raw);
    }
    if (wrapKey) {
      wipe(wrapKey);
    }
  }
}

/** Local / CI only: open with the fake release private key. Hosted must use KMS. */
export function openSharePWithReleasePrivateKey(
  sealed: SealedPatriaShare,
  releasePrivateKey: Uint8Array,
  aad: LetterPatriaShareAad,
): Uint8Array {
  requireLength(releasePrivateKey, P256_SECRET_BYTES);
  requireLength(sealed.ephemeralPublicKey, P256_COMPRESSED_PUBLIC_BYTES);
  let shared: Uint8Array | undefined;
  let raw: Uint8Array | undefined;
  let wrapKey: Uint8Array | undefined;
  try {
    shared = p256.getSharedSecret(releasePrivateKey, sealed.ephemeralPublicKey);
    raw = ecdhSharedSecretRaw(shared);
    wrapKey = derivePatriaShareWrapKey(raw, aad);
    return openXChaCha20Poly1305(wrapKey, sealed.sealedShare, encodeLetterPatriaShareInfo(aad));
  } finally {
    if (shared) {
      wipe(shared);
    }
    if (raw) {
      wipe(raw);
    }
    if (wrapKey) {
      wipe(wrapKey);
    }
  }
}

/** Open after KMS DeriveSharedSecret returned the 32-byte x-coordinate. */
export function openSharePWithDerivedSecret(
  sealed: SealedPatriaShare,
  kmsSharedSecretRaw: Uint8Array,
  aad: LetterPatriaShareAad,
): Uint8Array {
  const raw = ecdhSharedSecretRaw(kmsSharedSecretRaw);
  let wrapKey: Uint8Array | undefined;
  try {
    wrapKey = derivePatriaShareWrapKey(raw, aad);
    return openXChaCha20Poly1305(wrapKey, sealed.sealedShare, encodeLetterPatriaShareInfo(aad));
  } finally {
    wipe(raw);
    if (wrapKey) {
      wipe(wrapKey);
    }
  }
}

export function releasePublicKeyFromHex(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  requireLength(bytes, P256_COMPRESSED_PUBLIC_BYTES);
  return bytes;
}

export function releasePublicKeyToHex(publicKey: Uint8Array): string {
  requireLength(publicKey, P256_COMPRESSED_PUBLIC_BYTES);
  return bytesToHex(publicKey);
}
