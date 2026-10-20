// SECURITY REVIEW REQUIRED
import * as FileSystem from 'expo-file-system/legacy';

import { openXChaCha20Poly1305, sealXChaCha20Poly1305 } from './aead';
import { concatBytes, encodeUtf8Prefixed, utf8ToBytes, wipe } from './bytes';
import { deleteSecret, getSecretBytes, setSecretBytes } from './secureKeys';
import { randomKey32 } from './random';
import {
  parseVaultDecision,
  serializeVaultDecision,
  type VaultDecisionContent,
} from './vaultEnvelope';

const DRAFT_CONTEXT = utf8ToBytes('patria/vault-draft/v1');

export type VaultDraftFileGateway = {
  documentDirectory(): string | null;
  writeBase64(path: string, value: string): Promise<void>;
  readBase64(path: string): Promise<string | null>;
  delete(path: string): Promise<void>;
};

export const expoVaultDraftFileGateway: VaultDraftFileGateway = {
  documentDirectory() {
    return FileSystem.documentDirectory;
  },
  async writeBase64(path, value) {
    await FileSystem.writeAsStringAsync(path, value, {
      encoding: FileSystem.EncodingType.Base64,
    });
  },
  async readBase64(path) {
    try {
      return await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      return null;
    }
  },
  async delete(path) {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      return;
    }
  },
};

export function vaultDraftKeyStoreKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.vaultDraftKey.${spaceId}`;
}

export function vaultDraftFilePath(
  userId: string,
  spaceId: string,
  documentDirectory: string,
): string {
  return `${documentDirectory}patria-vault-draft-${userId}-${spaceId}.bin`;
}

function draftAad(userId: string, spaceId: string): Uint8Array {
  return concatBytes(DRAFT_CONTEXT, encodeUtf8Prefixed(userId), encodeUtf8Prefixed(spaceId));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function saveVaultDraft(
  userId: string,
  spaceId: string,
  content: VaultDecisionContent,
  files: VaultDraftFileGateway = expoVaultDraftFileGateway,
): Promise<void> {
  const directory = files.documentDirectory();
  if (!directory) {
    throw new Error('draft store unavailable');
  }
  let key = await getSecretBytes(vaultDraftKeyStoreKey(userId, spaceId));
  if (!key) {
    key = randomKey32();
    await setSecretBytes(vaultDraftKeyStoreKey(userId, spaceId), key);
  }
  const plaintext = serializeVaultDecision(content);
  try {
    const sealed = sealXChaCha20Poly1305(key, plaintext, draftAad(userId, spaceId));
    await files.writeBase64(vaultDraftFilePath(userId, spaceId, directory), bytesToBase64(sealed));
  } finally {
    wipe(key);
    wipe(plaintext);
  }
}

export async function loadVaultDraft(
  userId: string,
  spaceId: string,
  files: VaultDraftFileGateway = expoVaultDraftFileGateway,
): Promise<VaultDecisionContent | null> {
  const directory = files.documentDirectory();
  if (!directory) {
    return null;
  }
  const key = await getSecretBytes(vaultDraftKeyStoreKey(userId, spaceId));
  if (!key) {
    return null;
  }
  const encoded = await files.readBase64(vaultDraftFilePath(userId, spaceId, directory));
  if (!encoded) {
    wipe(key);
    return null;
  }
  try {
    const sealed = base64ToBytes(encoded);
    const plaintext = openXChaCha20Poly1305(key, sealed, draftAad(userId, spaceId));
    try {
      return parseVaultDecision(plaintext);
    } finally {
      wipe(plaintext);
    }
  } catch {
    return null;
  } finally {
    wipe(key);
  }
}

export async function clearVaultDraft(
  userId: string,
  spaceId: string,
  files: VaultDraftFileGateway = expoVaultDraftFileGateway,
): Promise<void> {
  const directory = files.documentDirectory();
  if (directory) {
    await files.delete(vaultDraftFilePath(userId, spaceId, directory));
  }
  await deleteSecret(vaultDraftKeyStoreKey(userId, spaceId));
}
