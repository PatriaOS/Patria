import * as SecureStore from 'expo-secure-store';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  LEGACY_DEVICE_ID_STORE_KEY,
  LEGACY_DEVICE_PRIVATE_STORE_KEY,
  deviceIdStoreKey,
  devicePrivateStoreKey,
  ensureDeviceIdentity,
  resetDeviceIdentityMemory,
} from './deviceIdentity';

const ELENA = '11111111-1111-1111-1111-111111111111';
const MARCO = '22222222-2222-2222-2222-222222222222';

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

describe('per-account device identity', () => {
  afterEach(() => {
    jest.useRealTimers();
    resetDeviceIdentityMemory();
  });

  it('keeps a separate device pair for each account on the same phone', async () => {
    const phone = new Map<string, string>();
    installMemoryStore(phone);

    const elena = await ensureDeviceIdentity(ELENA);
    const marco = await ensureDeviceIdentity(MARCO);
    expect(elena.deviceId).not.toBe(marco.deviceId);
    expect(bytesToHex(elena.privateKey)).not.toBe(bytesToHex(marco.privateKey));
    expect(phone.get(deviceIdStoreKey(ELENA))).toBe(elena.deviceId);
    expect(phone.get(deviceIdStoreKey(MARCO))).toBe(marco.deviceId);
    expect(phone.get(devicePrivateStoreKey(ELENA))).toBe(bytesToHex(elena.privateKey));
    expect(phone.has(devicePrivateStoreKey(MARCO))).toBe(true);

    const elenaAgain = await ensureDeviceIdentity(ELENA);
    expect(elenaAgain.deviceId).toBe(elena.deviceId);
  });

  it('does not let one account read another account device private key', async () => {
    const phone = new Map<string, string>();
    installMemoryStore(phone);
    const elena = await ensureDeviceIdentity(ELENA);
    await ensureDeviceIdentity(MARCO);
    expect(phone.get(devicePrivateStoreKey(MARCO))).not.toBe(bytesToHex(elena.privateKey));
    expect(phone.get(deviceIdStoreKey(MARCO))).not.toBe(elena.deviceId);
  });

  it('retries when SecureStore briefly returns null before minting', async () => {
    const phone = new Map<string, string>();
    installMemoryStore(phone);
    const first = await ensureDeviceIdentity(ELENA);
    // Dual-accessibility reads call getItemAsync twice per key; miss a few full
    // passes on the device pair so ensureDeviceIdentity must retry (not mint).
    let nullReads = 0;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      const isDevicePair =
        key === deviceIdStoreKey(ELENA) || key === devicePrivateStoreKey(ELENA);
      if (isDevicePair && nullReads < 8) {
        nullReads += 1;
        return null;
      }
      return phone.get(key) ?? null;
    });
    const again = await ensureDeviceIdentity(ELENA);
    expect(again.deviceId).toBe(first.deviceId);
    expect(bytesToHex(again.privateKey)).toBe(bytesToHex(first.privateKey));
    expect(nullReads).toBeGreaterThan(0);
    installMemoryStore(phone);
  });

  it('moves pre Step 4 device keys to the signed-in user only', async () => {
    const phone = new Map<string, string>();
    installMemoryStore(phone);
    const first = await ensureDeviceIdentity(ELENA);
    phone.set(LEGACY_DEVICE_ID_STORE_KEY, first.deviceId);
    phone.set(LEGACY_DEVICE_PRIVATE_STORE_KEY, bytesToHex(first.privateKey));
    phone.delete(deviceIdStoreKey(ELENA));
    phone.delete(devicePrivateStoreKey(ELENA));

    const migrated = await ensureDeviceIdentity(ELENA);
    expect(migrated.deviceId).toBe(first.deviceId);
    expect(bytesToHex(migrated.privateKey)).toBe(bytesToHex(first.privateKey));
    expect(phone.has(LEGACY_DEVICE_ID_STORE_KEY)).toBe(false);
    expect(phone.has(LEGACY_DEVICE_PRIVATE_STORE_KEY)).toBe(false);

    const marco = await ensureDeviceIdentity(MARCO);
    expect(marco.deviceId).not.toBe(first.deviceId);
    expect(phone.get(deviceIdStoreKey(ELENA))).toBe(first.deviceId);
    expect(phone.get(devicePrivateStoreKey(ELENA))).toBe(bytesToHex(first.privateKey));
  });
});
