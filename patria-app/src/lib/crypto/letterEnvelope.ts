// SECURITY REVIEW REQUIRED
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  decryptXChaCha20Poly1305Raw,
  encryptXChaCha20Poly1305Raw,
} from './aead';
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
import {
  padVaultAudio,
  unpadVaultAudio,
  VAULT_AUDIO_MAX_CIPHERTEXT,
} from './vaultAudio';
import { unwrapSecretWithAad, wrapSecretWithAad } from './wrap';

const CONTENT_CONTEXT = utf8ToBytes('patria/letter/v1');
const AUTHOR_CEK_CONTEXT = utf8ToBytes('patria/letter-cek-author/v1');
const RECIPIENT_SHARE_CONTEXT = utf8ToBytes('patria/letter-recipient-share/v1');
const LETTER_AUDIO_CONTEXT = utf8ToBytes('patria/letter-audio/v1');

export const LETTER_PAD_BLOCK = 1024;
export const LETTER_MAX_CIPHERTEXT = 65536;
export const LETTER_WRAPPED_CEK_BYTES = 48;
export const LETTER_FINGERPRINT_HEX_LEN = 12;

export type LetterAudioRef = {
  id: string;
  fileKey: string;
  nonce: string;
  durationSeconds: number;
  /** Ciphertext bytes of the sealed voice blob (for the tamper hash). */
  ciphertext?: Uint8Array;
};

export type LetterContent = {
  body: string;
  audio?: LetterAudioRef;
};

export type LetterContentAad = {
  familySpaceId: string;
  letterId: string;
  version: number;
  authorId: string;
};

export type LetterAuthorCekAad = {
  familySpaceId: string;
  letterId: string;
  version: number;
  authorId: string;
};

export type LetterRecipientShareAad = {
  letterId: string;
  version: number;
};

export type LetterAudioAad = {
  familySpaceId: string;
  letterId: string;
  audioId: string;
};

export type SealedLetterContent = {
  contentNonce: Uint8Array;
  ciphertext: Uint8Array;
  cek: Uint8Array;
  contentHash: Uint8Array;
  fingerprint: string;
};

export function encodeLetterContentAad(aad: LetterContentAad): Uint8Array {
  return concatBytes(
    CONTENT_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.letterId),
    u32be(aad.version),
    encodeUtf8Prefixed(aad.authorId),
  );
}

export function encodeLetterAuthorCekAad(aad: LetterAuthorCekAad): Uint8Array {
  return concatBytes(
    AUTHOR_CEK_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.letterId),
    u32be(aad.version),
    encodeUtf8Prefixed(aad.authorId),
  );
}

export function encodeLetterRecipientShareAad(aad: LetterRecipientShareAad): Uint8Array {
  return concatBytes(
    RECIPIENT_SHARE_CONTEXT,
    encodeUtf8Prefixed(aad.letterId),
    u32be(aad.version),
  );
}

export function encodeLetterAudioAad(aad: LetterAudioAad): Uint8Array {
  return concatBytes(
    LETTER_AUDIO_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.letterId),
    encodeUtf8Prefixed(aad.audioId),
  );
}

export function padLetterPlaintext(jsonBytes: Uint8Array): Uint8Array {
  const total = 4 + jsonBytes.length;
  const padded = Math.ceil(total / LETTER_PAD_BLOCK) * LETTER_PAD_BLOCK;
  const out = new Uint8Array(padded);
  out.set(u32be(jsonBytes.length), 0);
  out.set(jsonBytes, 4);
  return out;
}

export function unpadLetterPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.length < 4 || padded.length % LETTER_PAD_BLOCK !== 0) {
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

export function serializeLetterContent(content: LetterContent): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      body: content.body,
      ...(content.audio
        ? {
            audio: {
              id: content.audio.id,
              fileKey: content.audio.fileKey,
              nonce: content.audio.nonce,
              durationSeconds: content.audio.durationSeconds,
            },
          }
        : {}),
    }),
  );
}

export function parseLetterContent(jsonBytes: Uint8Array): LetterContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new Error('unwrap failed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('unwrap failed');
  }
  const row = parsed as { body?: unknown; audio?: unknown };
  if (typeof row.body !== 'string') {
    throw new Error('unwrap failed');
  }
  let audio: LetterAudioRef | undefined;
  if (row.audio !== undefined) {
    if (!row.audio || typeof row.audio !== 'object') {
      throw new Error('unwrap failed');
    }
    const a = row.audio as {
      id?: unknown;
      fileKey?: unknown;
      nonce?: unknown;
      durationSeconds?: unknown;
    };
    if (
      typeof a.id !== 'string' ||
      typeof a.fileKey !== 'string' ||
      typeof a.nonce !== 'string' ||
      typeof a.durationSeconds !== 'number'
    ) {
      throw new Error('unwrap failed');
    }
    audio = {
      id: a.id,
      fileKey: a.fileKey,
      nonce: a.nonce,
      durationSeconds: a.durationSeconds,
    };
  }
  return { body: row.body, audio };
}

/** SHA-256 over text ciphertext then any voice ciphertext bytes. */
export function hashLetterSealedPayload(
  textCiphertext: Uint8Array,
  voiceCiphertext?: Uint8Array,
): Uint8Array {
  if (voiceCiphertext && voiceCiphertext.length > 0) {
    return sha256(concatBytes(textCiphertext, voiceCiphertext));
  }
  return sha256(textCiphertext);
}

export function letterFingerprint(hash: Uint8Array): string {
  return bytesToHex(hash).slice(0, LETTER_FINGERPRINT_HEX_LEN);
}

export function sealLetterContent(
  content: LetterContent,
  aad: LetterContentAad,
  voiceCiphertext?: Uint8Array,
): SealedLetterContent {
  const cek = randomKey32();
  try {
    const plaintext = padLetterPlaintext(serializeLetterContent(content));
    if (plaintext.length > LETTER_MAX_CIPHERTEXT) {
      throw new Error('letter too large');
    }
    const contentNonce = randomNonce24();
    const aadBytes = encodeLetterContentAad(aad);
    const ciphertext = encryptXChaCha20Poly1305Raw(cek, contentNonce, plaintext, aadBytes);
    const contentHash = hashLetterSealedPayload(ciphertext, voiceCiphertext);
    return {
      contentNonce,
      ciphertext,
      cek,
      contentHash,
      fingerprint: letterFingerprint(contentHash),
    };
  } catch (error) {
    wipe(cek);
    throw error;
  }
}

export function openLetterContent(
  cek: Uint8Array,
  contentNonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: LetterContentAad,
): LetterContent {
  requireLength(cek, KEY_BYTES);
  requireLength(contentNonce, XCHACHA_NONCE_BYTES);
  const aadBytes = encodeLetterContentAad(aad);
  const padded = decryptXChaCha20Poly1305Raw(cek, contentNonce, ciphertext, aadBytes);
  try {
    return parseLetterContent(unpadLetterPlaintext(padded));
  } finally {
    wipe(padded);
  }
}

export function wrapLetterCekToAuthorPersonalKey(
  personalKey: Uint8Array,
  cek: Uint8Array,
  aad: LetterAuthorCekAad,
  nonce: Uint8Array = randomNonce24(),
): { nonce: Uint8Array; wrappedCek: Uint8Array } {
  requireLength(personalKey, KEY_BYTES);
  requireLength(cek, KEY_BYTES);
  const aadBytes = encodeLetterAuthorCekAad(aad);
  const wrappedCek = encryptXChaCha20Poly1305Raw(personalKey, nonce, cek, aadBytes);
  requireLength(wrappedCek, LETTER_WRAPPED_CEK_BYTES);
  return { nonce, wrappedCek };
}

export function unwrapLetterCekFromAuthorPersonalKey(
  personalKey: Uint8Array,
  nonce: Uint8Array,
  wrappedCek: Uint8Array,
  aad: LetterAuthorCekAad,
): Uint8Array {
  requireLength(personalKey, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  requireLength(wrappedCek, LETTER_WRAPPED_CEK_BYTES);
  return decryptXChaCha20Poly1305Raw(
    personalKey,
    nonce,
    wrappedCek,
    encodeLetterAuthorCekAad(aad),
  );
}

/** Seal shareR to the recipient's letterbox public key (X25519 sealed box). */
export function wrapLetterShareToLetterbox(
  shareR: Uint8Array,
  letterboxPublicKey: Uint8Array,
  aad: LetterRecipientShareAad,
): Uint8Array {
  return wrapSecretWithAad(shareR, letterboxPublicKey, encodeLetterRecipientShareAad(aad));
}

export function unwrapLetterShareFromLetterbox(
  wrapped: Uint8Array,
  letterboxPrivateKey: Uint8Array,
  aad: LetterRecipientShareAad,
): Uint8Array {
  return unwrapSecretWithAad(wrapped, letterboxPrivateKey, encodeLetterRecipientShareAad(aad));
}

export function sealLetterAudio(
  plain: Uint8Array,
  aad: LetterAudioAad,
): { fileKey: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array } {
  const fileKey = randomKey32();
  const nonce = randomNonce24();
  const padded = padVaultAudio(plain);
  try {
    const ciphertext = encryptXChaCha20Poly1305Raw(
      fileKey,
      nonce,
      padded,
      encodeLetterAudioAad(aad),
    );
    if (ciphertext.length > VAULT_AUDIO_MAX_CIPHERTEXT) {
      throw new Error('too large');
    }
    return { fileKey, nonce, ciphertext };
  } finally {
    wipe(padded);
  }
}

export function openLetterAudio(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: LetterAudioAad,
): Uint8Array {
  requireLength(fileKey, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  const padded = decryptXChaCha20Poly1305Raw(
    fileKey,
    nonce,
    ciphertext,
    encodeLetterAudioAad(aad),
  );
  try {
    const plain = unpadVaultAudio(padded);
    return plain.slice();
  } finally {
    wipe(padded);
  }
}
