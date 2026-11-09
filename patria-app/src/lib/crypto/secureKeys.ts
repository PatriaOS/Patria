// SECURITY REVIEW REQUIRED
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';

const ACCESSIBLE = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: ACCESSIBLE,
};

export function secureStoreOptions(): SecureStore.SecureStoreOptions {
  return STORE_OPTIONS;
}

export async function setSecretBytes(key: string, secret: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(key, bytesToHex(secret), STORE_OPTIONS);
}

export async function getSecretBytes(key: string): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(key, STORE_OPTIONS);
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
  await SecureStore.setItemAsync(key, value, STORE_OPTIONS);
}

export async function getSecretText(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, STORE_OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, STORE_OPTIONS);
}
