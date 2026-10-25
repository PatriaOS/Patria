// SECURITY REVIEW REQUIRED
import * as FileSystem from 'expo-file-system/legacy';

import { openVaultAudio } from '../../lib/crypto/vaultAudio';
import { wipe } from '../../lib/crypto/bytes';
import { vaultAudioRefKeys, type VaultAudioRef } from '../../lib/crypto/vaultEnvelope';
import { downloadVaultAudio } from './vaultApi';

const AUDIO_PREFIX = 'patria-vault-audio-';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return globalThis.btoa(binary);
}

export function vaultAudioCachePath(audioId: string, cacheDirectory: string): string {
  return `${cacheDirectory}${AUDIO_PREFIX}${audioId}.m4a`;
}

export async function wipeVaultAudioCache(
  cacheDirectory: string | null = FileSystem.cacheDirectory,
): Promise<void> {
  if (!cacheDirectory) {
    return;
  }
  let names: string[] = [];
  try {
    names = await FileSystem.readDirectoryAsync(cacheDirectory);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(AUDIO_PREFIX))
      .map((name) => FileSystem.deleteAsync(`${cacheDirectory}${name}`, { idempotent: true })),
  );
}

export async function decryptVaultAudioToCache(input: {
  spaceId: string;
  entryId: string;
  audio: VaultAudioRef;
}): Promise<string> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error('audio cache unavailable');
  }
  const path = vaultAudioCachePath(input.audio.id, cacheDirectory);
  const ciphertext = await downloadVaultAudio({
    spaceId: input.spaceId,
    entryId: input.entryId,
    audioId: input.audio.id,
  });
  const keys = vaultAudioRefKeys(input.audio);
  let plain: Uint8Array | undefined;
  try {
    plain = openVaultAudio(keys.fileKey, keys.nonce, ciphertext, {
      familySpaceId: input.spaceId,
      entryId: input.entryId,
      audioId: input.audio.id,
    });
    await FileSystem.writeAsStringAsync(path, bytesToBase64(plain), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  } finally {
    wipe(keys.fileKey);
    if (plain) {
      wipe(plain);
    }
  }
}

export async function deleteVaultAudioCacheFile(path: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    return;
  }
}
