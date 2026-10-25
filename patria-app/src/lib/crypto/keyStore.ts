// SECURITY REVIEW REQUIRED
import { wipe } from './bytes';
import { unwrapKeyFromDevice } from './wrap';
import { deleteSecret, getSecretBytes, setSecretBytes } from './secureKeys';

const memoryFamilyKeys = new Map<string, Uint8Array>();

export function familyKeyStoreKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.familyKey.${spaceId}`;
}

export function personalKeyStoreKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.personalKey.${spaceId}`;
}

export const personalKeyNeedsOtherPhone = 'approve-other-phone';

export function recoveryKeyStoreKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.recoveryKey.${spaceId}`;
}

export function legacyFamilyKeyStoreKey(spaceId: string): string {
  return `patria.familyKey.${spaceId}`;
}

export function legacyRecoveryKeyStoreKey(spaceId: string): string {
  return `patria.recoveryKey.${spaceId}`;
}

function memorySlot(userId: string, spaceId: string): string {
  return `${userId}:${spaceId}`;
}

function cloneKey(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

async function moveSecretBytes(fromKey: string, toKey: string): Promise<void> {
  const existing = await getSecretBytes(toKey);
  if (existing) {
    wipe(existing);
    const leftover = await getSecretBytes(fromKey);
    if (leftover) {
      wipe(leftover);
      await deleteSecret(fromKey);
    }
    return;
  }
  const legacy = await getSecretBytes(fromKey);
  if (!legacy) {
    return;
  }
  await setSecretBytes(toKey, legacy);
  wipe(legacy);
  await deleteSecret(fromKey);
}

export async function migrateLegacyFamilySecrets(userId: string, spaceId: string): Promise<void> {
  await moveSecretBytes(legacyFamilyKeyStoreKey(spaceId), familyKeyStoreKey(userId, spaceId));
  await moveSecretBytes(legacyRecoveryKeyStoreKey(spaceId), recoveryKeyStoreKey(userId, spaceId));
}

export function resetFamilyKeyMemory(): void {
  for (const value of memoryFamilyKeys.values()) {
    wipe(value);
  }
  memoryFamilyKeys.clear();
}

export async function discardLocalFamilySecrets(userId: string, spaceId: string): Promise<void> {
  const slot = memorySlot(userId, spaceId);
  const mem = memoryFamilyKeys.get(slot);
  if (mem) {
    wipe(mem);
    memoryFamilyKeys.delete(slot);
  }
  await deleteSecret(familyKeyStoreKey(userId, spaceId));
  await deleteSecret(recoveryKeyStoreKey(userId, spaceId));
  await deleteSecret(personalKeyStoreKey(userId, spaceId));
  await deleteSecret(legacyFamilyKeyStoreKey(spaceId));
  await deleteSecret(legacyRecoveryKeyStoreKey(spaceId));
}

export async function cachePersonalKey(
  userId: string,
  spaceId: string,
  personalKey: Uint8Array,
): Promise<void> {
  await setSecretBytes(personalKeyStoreKey(userId, spaceId), personalKey);
}

export async function loadCachedPersonalKey(
  userId: string,
  spaceId: string,
): Promise<Uint8Array | null> {
  return getSecretBytes(personalKeyStoreKey(userId, spaceId));
}

export async function unwrapCachedPersonalKey(
  userId: string,
  spaceId: string,
): Promise<Uint8Array | null> {
  return loadCachedPersonalKey(userId, spaceId);
}

export async function cacheFamilySecrets(
  userId: string,
  spaceId: string,
  familyKey: Uint8Array,
  recoveryKey?: Uint8Array,
): Promise<void> {
  const slot = memorySlot(userId, spaceId);
  const previous = memoryFamilyKeys.get(slot);
  if (previous) {
    wipe(previous);
  }
  memoryFamilyKeys.set(slot, cloneKey(familyKey));
  await setSecretBytes(familyKeyStoreKey(userId, spaceId), familyKey);
  if (recoveryKey) {
    await setSecretBytes(recoveryKeyStoreKey(userId, spaceId), recoveryKey);
  }
}

export async function loadCachedFamilyKey(
  userId: string,
  spaceId: string,
): Promise<Uint8Array | null> {
  return getSecretBytes(familyKeyStoreKey(userId, spaceId));
}

export async function loadCachedRecoveryKey(
  userId: string,
  spaceId: string,
): Promise<Uint8Array | null> {
  return getSecretBytes(recoveryKeyStoreKey(userId, spaceId));
}

export async function cacheRecoveryKey(
  userId: string,
  spaceId: string,
  recoveryKey: Uint8Array,
): Promise<void> {
  await setSecretBytes(recoveryKeyStoreKey(userId, spaceId), recoveryKey);
}

export async function obtainRecoveryKey(input: {
  userId: string;
  spaceId: string;
  deviceId: string;
  privateKey: Uint8Array | null;
  recoveryKeyEpoch: number;
  fetchOwnWrap: (
    spaceId: string,
    userId: string,
    deviceId: string,
  ) => Promise<{ wrappedKey: Uint8Array; keyEpoch: number } | null>;
}): Promise<Uint8Array | null> {
  const cached = await loadCachedRecoveryKey(input.userId, input.spaceId);
  if (cached) {
    return cached;
  }
  if (!input.privateKey || input.privateKey.length === 0) {
    return null;
  }
  const own = await input.fetchOwnWrap(input.spaceId, input.userId, input.deviceId);
  if (!own) {
    return null;
  }
  try {
    const opened = unwrapKeyFromDevice(own.wrappedKey, input.privateKey, {
      familySpaceId: input.spaceId,
      keyEpoch: own.keyEpoch,
      userId: input.userId,
      deviceId: input.deviceId,
    });
    await cacheRecoveryKey(input.userId, input.spaceId, opened);
    return opened;
  } catch {
    return null;
  }
}

export async function obtainFamilyKey(input: {
  userId: string;
  spaceId: string;
  deviceId: string;
  privateKey: Uint8Array | null;
  fetchOwnWrap: (
    spaceId: string,
    userId: string,
    deviceId: string,
  ) => Promise<{ wrappedKey: Uint8Array; keyEpoch: number } | null>;
}): Promise<Uint8Array | null> {
  await migrateLegacyFamilySecrets(input.userId, input.spaceId);
  if (input.privateKey && input.privateKey.length > 0) {
    const own = await input.fetchOwnWrap(input.spaceId, input.userId, input.deviceId);
    if (own) {
      try {
        const opened = unwrapKeyFromDevice(own.wrappedKey, input.privateKey, {
          familySpaceId: input.spaceId,
          keyEpoch: own.keyEpoch,
          userId: input.userId,
          deviceId: input.deviceId,
        });
        await cacheFamilySecrets(input.userId, input.spaceId, opened);
        return opened;
      } catch {
        // Fall back to a cached copy from this phone.
      }
    }
  }
  const slot = memorySlot(input.userId, input.spaceId);
  const mem = memoryFamilyKeys.get(slot);
  if (mem) {
    return cloneKey(mem);
  }
  const cached = await loadCachedFamilyKey(input.userId, input.spaceId);
  if (cached) {
    memoryFamilyKeys.set(slot, cloneKey(cached));
    return cached;
  }
  return null;
}
