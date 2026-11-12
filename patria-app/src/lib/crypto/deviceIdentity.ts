// SECURITY REVIEW REQUIRED
import { bytesToHex } from '@noble/hashes/utils.js';
import { wipe } from './bytes';
import { generateDeviceKeyPair, x25519PublicKey } from './x25519';
import { randomBytes } from './random';
import { deleteSecret, getSecretBytes, getSecretText, setSecretBytes, setSecretText } from './secureKeys';

export const LEGACY_DEVICE_ID_STORE_KEY = 'patria.device.id';
export const LEGACY_DEVICE_PRIVATE_STORE_KEY = 'patria.device.private';

export type DeviceIdentity = {
  deviceId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};

export function deviceIdStoreKey(userId: string): string {
  return `patria.u.${userId}.device.id`;
}

export function devicePrivateStoreKey(userId: string): string {
  return `patria.u.${userId}.device.private`;
}

/** Non-secret list of device ids this installation has used (for stale-phone labels). */
export function deviceIdHistoryStoreKey(userId: string): string {
  return `patria.u.${userId}.device.id.history`;
}

export async function loadLocalDeviceIdHistory(userId: string): Promise<string[]> {
  const raw = await getSecretText(deviceIdHistoryStoreKey(userId));
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

async function recordDeviceIdInHistory(userId: string, deviceId: string): Promise<void> {
  const existing = await loadLocalDeviceIdHistory(userId);
  if (existing.includes(deviceId)) {
    return;
  }
  await setSecretText(deviceIdHistoryStoreKey(userId), JSON.stringify([...existing, deviceId]));
}

function randomDeviceId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function moveSecretText(fromKey: string, toKey: string): Promise<void> {
  const existing = await getSecretText(toKey);
  const legacy = await getSecretText(fromKey);
  if (!existing && legacy) {
    await setSecretText(toKey, legacy);
  }
  if ((await getSecretText(toKey)) != null && legacy != null) {
    await deleteSecret(fromKey);
  }
}

async function moveSecretBytes(fromKey: string, toKey: string): Promise<void> {
  const existing = await getSecretBytes(toKey);
  const leftover = await getSecretBytes(fromKey);
  if (existing) {
    if (leftover) {
      leftover.fill(0);
      await deleteSecret(fromKey);
    }
    return;
  }
  if (!leftover) {
    return;
  }
  await setSecretBytes(toKey, leftover);
  leftover.fill(0);
  await deleteSecret(fromKey);
}

export async function migrateLegacyDeviceIdentity(userId: string): Promise<void> {
  await moveSecretText(LEGACY_DEVICE_ID_STORE_KEY, deviceIdStoreKey(userId));
  await moveSecretBytes(LEGACY_DEVICE_PRIVATE_STORE_KEY, devicePrivateStoreKey(userId));
}

async function readDeviceIdentity(
  userId: string,
): Promise<{ id: string | null; privateKey: Uint8Array | null }> {
  return {
    id: await getSecretText(deviceIdStoreKey(userId)),
    privateKey: await getSecretBytes(devicePrivateStoreKey(userId)),
  };
}

/** Survives brief SecureStore nulls in the same JS session (Maestro relaunch). */
const memoryIdentities = new Map<string, DeviceIdentity>();

function cloneIdentity(identity: DeviceIdentity): DeviceIdentity {
  const privateKey = new Uint8Array(identity.privateKey);
  return {
    deviceId: identity.deviceId,
    privateKey,
    publicKey: x25519PublicKey(privateKey),
  };
}

function rememberIdentity(userId: string, identity: DeviceIdentity): DeviceIdentity {
  const stored = cloneIdentity(identity);
  const previous = memoryIdentities.get(userId);
  if (previous) {
    wipe(previous.privateKey);
    wipe(previous.publicKey);
  }
  memoryIdentities.set(userId, stored);
  return cloneIdentity(stored);
}

/** Test helper — clears the in-memory device cache. */
export function resetDeviceIdentityMemory(): void {
  for (const identity of memoryIdentities.values()) {
    wipe(identity.privateKey);
    wipe(identity.publicKey);
  }
  memoryIdentities.clear();
}

async function finishIdentity(userId: string, identity: DeviceIdentity): Promise<DeviceIdentity> {
  await recordDeviceIdInHistory(userId, identity.deviceId);
  return rememberIdentity(userId, identity);
}

export async function ensureDeviceIdentity(userId: string): Promise<DeviceIdentity> {
  await migrateLegacyDeviceIdentity(userId);
  let { id: existingId, privateKey: existingPrivate } = await readDeviceIdentity(userId);
  if (existingId && existingPrivate) {
    return finishIdentity(userId, {
      deviceId: existingId,
      privateKey: existingPrivate,
      publicKey: x25519PublicKey(existingPrivate),
    });
  }

  // Cold start / Maestro launchApp can briefly return null for SecureStore.
  // A few short retries before minting — overwriting an existing pair orphans
  // personal wraps and breaks keeper Help (approve-other-phone). Keep this
  // short so a real first launch after clearKeychain is not slowed for seconds.
  if (!existingId || !existingPrivate) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const pair = await readDeviceIdentity(userId);
      existingId = pair.id;
      existingPrivate = pair.privateKey;
      if (existingId && existingPrivate) {
        return finishIdentity(userId, {
          deviceId: existingId,
          privateKey: existingPrivate,
          publicKey: x25519PublicKey(existingPrivate),
        });
      }
    }
  }

  // Session memory: SecureStore flaked after we already loaded this user once.
  // Re-write the pair instead of minting (mint orphans personal_key_wraps).
  const remembered = memoryIdentities.get(userId);
  if (remembered) {
    await setSecretText(deviceIdStoreKey(userId), remembered.deviceId);
    await setSecretBytes(devicePrivateStoreKey(userId), remembered.privateKey);
    await recordDeviceIdInHistory(userId, remembered.deviceId);
    return cloneIdentity(remembered);
  }

  // Id without private after retries: do not mint (would orphan wraps).
  if (existingId && !existingPrivate) {
    throw new Error('device-private-unavailable');
  }

  // Private without id: drop the orphan private and mint a fresh pair.
  if (existingPrivate && !existingId) {
    wipe(existingPrivate);
    await deleteSecret(devicePrivateStoreKey(userId));
  }

  const pair = generateDeviceKeyPair();
  const deviceId = randomDeviceId();
  await setSecretText(deviceIdStoreKey(userId), deviceId);
  await setSecretBytes(devicePrivateStoreKey(userId), pair.privateKey);
  return finishIdentity(userId, {
    deviceId,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  });
}
