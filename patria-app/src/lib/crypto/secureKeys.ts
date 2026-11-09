// SECURITY REVIEW REQUIRED
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';

/**
 * Prefer AFTER_FIRST_UNLOCK so brief simulator lock / Maestro relaunch does not
 * make getItemAsync return null (which used to mint a new device id and orphan
 * personal_key_wraps). Still read WHEN_UNLOCKED so older installs keep working.
 */
const WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const READ_OPTIONS: SecureStore.SecureStoreOptions[] = [
  WRITE_OPTIONS,
  { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
];

export function secureStoreOptions(): SecureStore.SecureStoreOptions {
  return WRITE_OPTIONS;
}

async function readRaw(key: string): Promise<string | null> {
  for (const options of READ_OPTIONS) {
    try {
      const value = await SecureStore.getItemAsync(key, options);
      if (value != null) {
        return value;
      }
    } catch {
      // Try the next accessibility class.
    }
  }
  return null;
}

async function deleteRaw(key: string): Promise<void> {
  for (const options of READ_OPTIONS) {
    try {
      await SecureStore.deleteItemAsync(key, options);
    } catch {
      // Item may only exist under one accessibility class.
    }
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  // Write AFTER_FIRST_UNLOCK first, then a WHEN_UNLOCKED copy. Never delete the
  // other class before the new write lands — that orphaned device keys under
  // Maestro (SecureStore briefly empty → remint → approve-other-phone).
  await SecureStore.setItemAsync(key, value, WRITE_OPTIONS);
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Best-effort dual write for flaky simulator accessibility classes.
  }
}

export async function setSecretBytes(key: string, secret: Uint8Array): Promise<void> {
  await writeRaw(key, bytesToHex(secret));
}

export async function getSecretBytes(key: string): Promise<Uint8Array | null> {
  const hex = await readRaw(key);
  if (hex == null) {
    return null;
  }
  try {
    return hexToBytes(hex);
  } catch {
    return null;
  }
}

export async function setSecretText(key: string, value: string): Promise<void> {
  await writeRaw(key, value);
}

export async function getSecretText(key: string): Promise<string | null> {
  return readRaw(key);
}

export async function deleteSecret(key: string): Promise<void> {
  await deleteRaw(key);
}
