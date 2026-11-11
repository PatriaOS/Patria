import { bytesToHex } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';
import { secretsEqual, wipe } from './bytes';
import {
  ensureDeviceIdentity,
  LEGACY_DEVICE_ID_STORE_KEY,
  LEGACY_DEVICE_PRIVATE_STORE_KEY,
  deviceIdStoreKey,
  devicePrivateStoreKey,
  resetDeviceIdentityMemory,
} from './deviceIdentity';
import type { DeviceAccessGateway } from './deviceAccess';
import {
  createFoundingMaterial,
  discardLocalFamilySecrets,
  ensureKeysForOpenFamily,
  familyKeyStoreKey,
  payloadContainsPlaintextKey,
  recoveryKeyStoreKey,
  runFoundingCeremony,
  unwrapFoundingFamilyKey,
  type FamilyKeyGateway,
} from './familyCeremony';
import {
  legacyFamilyKeyStoreKey,
  legacyRecoveryKeyStoreKey,
  resetFamilyKeyMemory,
} from './keyStore';
import { randomKey32 } from './random';
import { getSecretBytes } from './secureKeys';
import { wrapKeyToDevice } from './wrap';

jest.mock('./rotateFamilyKey', () => ({
  rotateFamilyKeyIfNeeded: jest.fn(async () => false),
}));

const USER = '22222222-2222-2222-2222-222222222222';
const TEEN = '33333333-3333-3333-3333-333333333333';
const SPACE = '11111111-1111-1111-1111-111111111111';

function installMemoryStore(store: Map<string, string>): void {
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
}

function memoryGateway(options?: {
  meta?: { keyEpoch: number } | null;
  commit?: FamilyKeyGateway['commitCeremony'];
  wraps?: FamilyKeyGateway['fetchOwnWraps'];
}): FamilyKeyGateway {
  return {
    fetchMeta: async () => options?.meta ?? null,
    fetchOwnWraps: options?.wraps ?? (async () => []),
    commitCeremony: options?.commit ?? (async () => ({ ok: true as const })),
  };
}

function memoryAccess(insertNotice = jest.fn(async () => undefined)): DeviceAccessGateway {
  return {
    upsertDevicePublicKey: jest.fn(async () => undefined),
    countOwnWraps: jest.fn(async () => 0),
    insertNotice,
    listNotices: jest.fn(async () => []),
    fetchOwnWrap: jest.fn(async () => null),
    insertFamilyWrap: jest.fn(async () => undefined),
    insertRecoveryWrap: jest.fn(async () => undefined),
    deleteNotice: jest.fn(async () => undefined),
    rejectPendingDevice: jest.fn(async () => undefined),
    removeOwnDevice: jest.fn(async () => undefined),
    listOwnPhones: jest.fn(async () => []),
  };
}

describe('founding family key ceremony', () => {
  beforeEach(() => {
    resetDeviceIdentityMemory();
    resetFamilyKeyMemory();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('wraps keys for create family without sending plaintext', async () => {
    const device = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
    });

    expect(material.payload.wrappedFamilyKey.length).toBeGreaterThan(32);
    expect(payloadContainsPlaintextKey(material.payload, material.familyKey)).toBe(false);

    const opened = unwrapFoundingFamilyKey(material.payload, device.privateKey, USER);
    expect(secretsEqual(opened, material.familyKey)).toBe(true);
    wipe(material.familyKey);
  });

  it('caches keys after a successful create-family commit', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);

    const status = await runFoundingCeremony({ spaceId: SPACE, userId: USER }, memoryGateway());
    expect(status).toBe('ready');
    expect(await getSecretBytes(familyKeyStoreKey(USER, SPACE))).not.toBeNull();
    expect(await getSecretBytes(recoveryKeyStoreKey(USER, SPACE))).toBeNull();
  });

  it('runs lazy creation when an admin opens a family with no meta', async () => {
    const commit = jest.fn(async () => ({ ok: true as const }));
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'co_admin' },
      memoryGateway({ meta: null, commit }),
      memoryAccess(),
    );
    expect(commit).toHaveBeenCalled();
    expect(status).toBe('ready');
  });

  it('does not create a key when meta already exists', async () => {
    const commit = jest.fn(async () => ({ ok: true as const }));
    const insertNotice = jest.fn(async () => undefined);
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'family_admin' },
      memoryGateway({ meta: { keyEpoch: 1 }, commit }),
      memoryAccess(insertNotice),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(insertNotice).toHaveBeenCalled();
    expect(status).toBe('waiting');
  });

  it('shows waiting again with a fresh request after a pending request expired', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);
    const upsert = jest.fn(async () => undefined);
    const insertNotice = jest.fn(async () => undefined);
    const access = memoryAccess(insertNotice);
    access.upsertDevicePublicKey = upsert;

    const first = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'teen' },
      memoryGateway({ meta: { keyEpoch: 1 } }),
      access,
    );
    expect(first).toBe('waiting');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(insertNotice).toHaveBeenCalledTimes(1);

    // Server expired the never-approved device_keys + notice; local identity remains.
    const again = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'teen' },
      memoryGateway({ meta: { keyEpoch: 1 } }),
      access,
    );
    expect(again).toBe('waiting');
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(insertNotice).toHaveBeenCalledTimes(2);
    await expect(getSecretBytes(familyKeyStoreKey(USER, SPACE))).resolves.toBeNull();
  });

  it('discards the local key when this phone loses the race', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);

    const status = await runFoundingCeremony(
      { spaceId: SPACE, userId: USER },
      memoryGateway({
        commit: async () => ({ ok: false, code: '23505' }),
      }),
    );
    expect(status).toBe('waiting');
    expect(await getSecretBytes(familyKeyStoreKey(USER, SPACE))).toBeNull();
    expect(await getSecretBytes(recoveryKeyStoreKey(USER, SPACE))).toBeNull();
  });

  it('never creates a family key for a non admin', async () => {
    const commit = jest.fn(async () => ({ ok: true as const }));
    const insertNotice = jest.fn(async () => undefined);
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: TEEN, role: 'teen' },
      memoryGateway({ meta: null, commit }),
      memoryAccess(insertNotice),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(insertNotice).toHaveBeenCalled();
    expect(status).toBe('waiting');
  });

  it('leaves nothing half saved when the server call fails', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);

    const status = await runFoundingCeremony(
      { spaceId: SPACE, userId: USER },
      memoryGateway({
        commit: async () => {
          throw new Error('network');
        },
      }),
    );
    expect(status).toBe('waiting');
    expect(await getSecretBytes(familyKeyStoreKey(USER, SPACE))).toBeNull();
    await discardLocalFamilySecrets(USER, SPACE);
  });

  it('rebuilds the family key from this device wrap after an empty cache', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);
    const device = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
    });
    const wrapped = wrapKeyToDevice(material.familyKey, device.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: USER,
      deviceId: device.deviceId,
    });
    resetFamilyKeyMemory();
    stored.delete(familyKeyStoreKey(USER, SPACE));
    const insertNotice = jest.fn(async () => undefined);
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'family_admin' },
      memoryGateway({
        meta: { keyEpoch: 1 },
        wraps: async () => [{ deviceId: device.deviceId, wrappedKey: wrapped, keyEpoch: 1 }],
      }),
      memoryAccess(insertNotice),
    );
    expect(status).toBe('ready');
    expect(insertNotice).not.toHaveBeenCalled();
    expect(await getSecretBytes(familyKeyStoreKey(USER, SPACE))).not.toBeNull();
    wipe(material.familyKey);
  });

  it('moves pre Step 4 SecureStore names to the signed-in user', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);
    const device = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
    });
    const wrapped = wrapKeyToDevice(material.familyKey, device.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: USER,
      deviceId: device.deviceId,
    });
    stored.set(LEGACY_DEVICE_ID_STORE_KEY, device.deviceId);
    stored.set(LEGACY_DEVICE_PRIVATE_STORE_KEY, bytesToHex(device.privateKey));
    stored.set(legacyFamilyKeyStoreKey(SPACE), bytesToHex(material.familyKey));
    stored.set(legacyRecoveryKeyStoreKey(SPACE), bytesToHex(randomKey32()));
    stored.delete(deviceIdStoreKey(USER));
    stored.delete(devicePrivateStoreKey(USER));
    stored.delete(familyKeyStoreKey(USER, SPACE));
    stored.delete(recoveryKeyStoreKey(USER, SPACE));
    resetFamilyKeyMemory();

    // Ready requires a live wrap for this device — legacy cache alone is not enough
    // (stale cache after device-id rotation caused keeper Help approve-other-phone).
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'family_admin' },
      memoryGateway({
        meta: { keyEpoch: 1 },
        wraps: async () => [{ deviceId: device.deviceId, wrappedKey: wrapped, keyEpoch: 1 }],
      }),
      memoryAccess(),
    );
    expect(status).toBe('ready');
    expect(stored.get(deviceIdStoreKey(USER))).toBe(device.deviceId);
    expect(stored.get(devicePrivateStoreKey(USER))).toBe(bytesToHex(device.privateKey));
    expect(await getSecretBytes(familyKeyStoreKey(USER, SPACE))).not.toBeNull();
    expect(stored.has(LEGACY_DEVICE_ID_STORE_KEY)).toBe(false);
    expect(stored.has(legacyFamilyKeyStoreKey(SPACE))).toBe(false);
    wipe(material.familyKey);
  });

  it('asks to be let in again when this device has no private key', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);
    const device = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
    });
    const wrapped = wrapKeyToDevice(material.familyKey, device.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: USER,
      deviceId: device.deviceId,
    });
    stored.delete(devicePrivateStoreKey(USER));
    stored.delete(familyKeyStoreKey(USER, SPACE));
    resetFamilyKeyMemory();
    // Simulate a cold process (memory gone) with id left on disk and no private.
    resetDeviceIdentityMemory();
    await expect(
      ensureKeysForOpenFamily(
        { spaceId: SPACE, userId: USER, role: 'family_admin' },
        memoryGateway({
          meta: { keyEpoch: 1 },
          wraps: async () => [{ deviceId: device.deviceId, wrappedKey: wrapped, keyEpoch: 1 }],
        }),
        memoryAccess(),
      ),
    ).rejects.toThrow('device-private-unavailable');
    wipe(material.familyKey);
  });

  it('waits for another of this member’s phones when this device has no wrap', async () => {
    const stored = new Map<string, string>();
    installMemoryStore(stored);
    const oldDevice = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: oldDevice.deviceId,
      publicKey: oldDevice.publicKey,
    });
    const wrapped = wrapKeyToDevice(material.familyKey, oldDevice.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: USER,
      deviceId: oldDevice.deviceId,
    });
    stored.clear();
    resetFamilyKeyMemory();
    resetDeviceIdentityMemory();
    installMemoryStore(stored);
    const insertNotice = jest.fn(async () => undefined);
    const status = await ensureKeysForOpenFamily(
      { spaceId: SPACE, userId: USER, role: 'teen' },
      memoryGateway({
        meta: { keyEpoch: 1 },
        wraps: async () => [{ deviceId: oldDevice.deviceId, wrappedKey: wrapped, keyEpoch: 1 }],
      }),
      memoryAccess(insertNotice),
    );
    expect(status).toBe('waitingOwnPhone');
    expect(insertNotice).toHaveBeenCalled();
    wipe(material.familyKey);
  });

  it('does not put the family key hex in the postgres payload', async () => {
    const device = await ensureDeviceIdentity(USER);
    const material = createFoundingMaterial({
      spaceId: SPACE,
      userId: USER,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
    });
    const familyHex = bytesToHex(material.familyKey);
    expect(bytesToHex(material.payload.wrappedFamilyKey).includes(familyHex)).toBe(false);
  });
});
