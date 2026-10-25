// SECURITY REVIEW REQUIRED
import { decryptXChaCha20Poly1305Raw, encryptXChaCha20Poly1305Raw } from './aead';
import {
  concatBytes,
  encodeUtf8Prefixed,
  readU32be,
  requireLength,
  u32be,
  utf8ToBytes,
  wipe,
} from './bytes';
import { KEY_BYTES, XCHACHA_NONCE_BYTES, randomKey32, randomNonce24 } from './random';

export const VAULT_AUDIO_PAD_BLOCK = 256 * 1024;
export const VAULT_AUDIO_MAX_CIPHERTEXT = 6 * 1024 * 1024;
export const VAULT_AUDIO_MAX_SECONDS = 300;
const AUDIO_CONTEXT = utf8ToBytes('patria/vault-audio/v1');

export type VaultAudioAad = {
  familySpaceId: string;
  entryId: string;
  audioId: string;
};

export function encodeVaultAudioAad(aad: VaultAudioAad): Uint8Array {
  return concatBytes(
    AUDIO_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.entryId),
    encodeUtf8Prefixed(aad.audioId),
  );
}

export function padVaultAudio(plain: Uint8Array): Uint8Array {
  const total = 4 + plain.length;
  const padded = Math.ceil(total / VAULT_AUDIO_PAD_BLOCK) * VAULT_AUDIO_PAD_BLOCK;
  const out = new Uint8Array(padded);
  out.set(u32be(plain.length), 0);
  out.set(plain, 4);
  return out;
}

export function unpadVaultAudio(padded: Uint8Array): Uint8Array {
  if (padded.length < 4 || padded.length % VAULT_AUDIO_PAD_BLOCK !== 0) {
    throw new Error('unwrap failed');
  }
  const length = readU32be(padded, 0);
  if (length > padded.length - 4) {
    throw new Error('unwrap failed');
  }
  for (let i = 4 + length; i < padded.length; i += 1) {
    if (padded[i] !== 0) {
      throw new Error('unwrap failed');
    }
  }
  return padded.subarray(4, 4 + length);
}

export function shouldStopVaultRecording(elapsedSeconds: number): boolean {
  return elapsedSeconds >= VAULT_AUDIO_MAX_SECONDS;
}

export function sealVaultAudio(
  plain: Uint8Array,
  aad: VaultAudioAad,
): { fileKey: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array } {
  const fileKey = randomKey32();
  const nonce = randomNonce24();
  const padded = padVaultAudio(plain);
  try {
    const ciphertext = encryptXChaCha20Poly1305Raw(
      fileKey,
      nonce,
      padded,
      encodeVaultAudioAad(aad),
    );
    if (ciphertext.length > VAULT_AUDIO_MAX_CIPHERTEXT) {
      throw new Error('too large');
    }
    return { fileKey, nonce, ciphertext };
  } finally {
    wipe(padded);
  }
}

export function openVaultAudio(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: VaultAudioAad,
): Uint8Array {
  requireLength(fileKey, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  const padded = decryptXChaCha20Poly1305Raw(
    fileKey,
    nonce,
    ciphertext,
    encodeVaultAudioAad(aad),
  );
  try {
    const plain = unpadVaultAudio(padded);
    return new Uint8Array(plain);
  } finally {
    wipe(padded);
  }
}
