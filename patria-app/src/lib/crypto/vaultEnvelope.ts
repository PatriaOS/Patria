// SECURITY REVIEW REQUIRED
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

export const VAULT_PAD_BLOCK = 1024;
export const VAULT_MAX_CIPHERTEXT = 65536;
export const VAULT_WRAPPED_CEK_BYTES = 48;
const CONTENT_CONTEXT = utf8ToBytes('patria/vault/v1');
const CEK_CONTEXT = utf8ToBytes('patria/vault-cek/v1');

export type VaultDecisionContent = {
  title: string;
  body: string;
  for: string;
};

export type VaultContentAad = {
  familySpaceId: string;
  entryId: string;
  version: number;
  authorId: string;
};

export type VaultCekAad = {
  familySpaceId: string;
  entryId: string;
  version: number;
  keyEpoch: number;
};

export type SealedVaultEntry = {
  contentNonce: Uint8Array;
  ciphertext: Uint8Array;
  cekNonce: Uint8Array;
  wrappedCek: Uint8Array;
};

export function encodeVaultContentAad(aad: VaultContentAad): Uint8Array {
  return concatBytes(
    CONTENT_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.entryId),
    u32be(aad.version),
    encodeUtf8Prefixed(aad.authorId),
  );
}

export function encodeVaultCekAad(aad: VaultCekAad): Uint8Array {
  return concatBytes(
    CEK_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.entryId),
    u32be(aad.version),
    u32be(aad.keyEpoch),
  );
}

export function padVaultPlaintext(jsonBytes: Uint8Array): Uint8Array {
  const total = 4 + jsonBytes.length;
  const padded = Math.ceil(total / VAULT_PAD_BLOCK) * VAULT_PAD_BLOCK;
  const out = new Uint8Array(padded);
  out.set(u32be(jsonBytes.length), 0);
  out.set(jsonBytes, 4);
  return out;
}

export function unpadVaultPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.length < 4 || padded.length % VAULT_PAD_BLOCK !== 0) {
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

export function serializeVaultDecision(content: VaultDecisionContent): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      title: content.title,
      body: content.body,
      for: content.for,
    }),
  );
}

export function parseVaultDecision(jsonBytes: Uint8Array): VaultDecisionContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new Error('unwrap failed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('unwrap failed');
  }
  const row = parsed as { title?: unknown; body?: unknown; for?: unknown };
  if (typeof row.title !== 'string' || typeof row.body !== 'string') {
    throw new Error('unwrap failed');
  }
  return {
    title: row.title,
    body: row.body,
    for: typeof row.for === 'string' ? row.for : '',
  };
}

export function wrapVaultCek(
  familyKey: Uint8Array,
  cek: Uint8Array,
  aad: VaultCekAad,
  nonce: Uint8Array = randomNonce24(),
): { nonce: Uint8Array; wrappedCek: Uint8Array } {
  requireLength(familyKey, KEY_BYTES);
  requireLength(cek, KEY_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  const wrappedCek = encryptXChaCha20Poly1305Raw(familyKey, nonce, cek, encodeVaultCekAad(aad));
  requireLength(wrappedCek, VAULT_WRAPPED_CEK_BYTES);
  return { nonce, wrappedCek };
}

export function openVaultCek(
  familyKey: Uint8Array,
  wrappedCek: Uint8Array,
  nonce: Uint8Array,
  aad: VaultCekAad,
): Uint8Array {
  requireLength(familyKey, KEY_BYTES);
  requireLength(wrappedCek, VAULT_WRAPPED_CEK_BYTES);
  requireLength(nonce, XCHACHA_NONCE_BYTES);
  return decryptXChaCha20Poly1305Raw(familyKey, nonce, wrappedCek, encodeVaultCekAad(aad));
}

export function rewrapVaultCek(
  oldFamilyKey: Uint8Array,
  newFamilyKey: Uint8Array,
  input: {
    wrappedCek: Uint8Array;
    cekNonce: Uint8Array;
    familySpaceId: string;
    entryId: string;
    version: number;
    oldEpoch: number;
    nextEpoch: number;
  },
): { nonce: Uint8Array; wrappedCek: Uint8Array } {
  const cek = openVaultCek(oldFamilyKey, input.wrappedCek, input.cekNonce, {
    familySpaceId: input.familySpaceId,
    entryId: input.entryId,
    version: input.version,
    keyEpoch: input.oldEpoch,
  });
  try {
    return wrapVaultCek(newFamilyKey, cek, {
      familySpaceId: input.familySpaceId,
      entryId: input.entryId,
      version: input.version,
      keyEpoch: input.nextEpoch,
    });
  } finally {
    wipe(cek);
  }
}

export function sealVaultDecision(
  familyKey: Uint8Array,
  content: VaultDecisionContent,
  aad: VaultContentAad & { keyEpoch: number },
): SealedVaultEntry {
  requireLength(familyKey, KEY_BYTES);
  const jsonBytes = serializeVaultDecision(content);
  const padded = padVaultPlaintext(jsonBytes);
  const cek = randomKey32();
  const contentNonce = randomNonce24();
  try {
    const ciphertext = encryptXChaCha20Poly1305Raw(
      cek,
      contentNonce,
      padded,
      encodeVaultContentAad(aad),
    );
    if (ciphertext.length > VAULT_MAX_CIPHERTEXT) {
      throw new Error('too large');
    }
    const wrapped = wrapVaultCek(familyKey, cek, {
      familySpaceId: aad.familySpaceId,
      entryId: aad.entryId,
      version: aad.version,
      keyEpoch: aad.keyEpoch,
    });
    return {
      contentNonce,
      ciphertext,
      cekNonce: wrapped.nonce,
      wrappedCek: wrapped.wrappedCek,
    };
  } finally {
    wipe(cek);
    wipe(padded);
  }
}

export function openVaultDecision(
  familyKey: Uint8Array,
  sealed: SealedVaultEntry,
  aad: VaultContentAad & { keyEpoch: number },
): VaultDecisionContent {
  const cek = openVaultCek(familyKey, sealed.wrappedCek, sealed.cekNonce, {
    familySpaceId: aad.familySpaceId,
    entryId: aad.entryId,
    version: aad.version,
    keyEpoch: aad.keyEpoch,
  });
  try {
    const padded = decryptXChaCha20Poly1305Raw(
      cek,
      sealed.contentNonce,
      sealed.ciphertext,
      encodeVaultContentAad(aad),
    );
    try {
      return parseVaultDecision(unpadVaultPlaintext(padded));
    } finally {
      wipe(padded);
    }
  } finally {
    wipe(cek);
  }
}
