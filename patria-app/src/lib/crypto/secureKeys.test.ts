import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getSecretBytes, setSecretBytes, secureStoreOptions } from './secureKeys';

describe('secure key storage', () => {
  it('writes with AFTER_FIRST_UNLOCK and reads that class first', async () => {
    const setItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
      typeof SecureStore.setItemAsync
    >;
    const getItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
      typeof SecureStore.getItemAsync
    >;
    setItemAsync.mockResolvedValue(undefined);
    getItemAsync.mockResolvedValue('aabb');

    const secret = hexToBytes('aabb');
    await setSecretBytes('patria.device.private', secret);

    expect(setItemAsync).toHaveBeenCalledWith('patria.device.private', 'aabb', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    expect(setItemAsync).toHaveBeenCalledWith('patria.device.private', 'aabb', {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(secureStoreOptions().keychainAccessible).toBe(
      SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    );

    const loaded = await getSecretBytes('patria.device.private');
    expect(getItemAsync).toHaveBeenCalledWith('patria.device.private', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    expect(loaded && bytesToHex(loaded)).toBe('aabb');
  });

  it('falls back to WHEN_UNLOCKED when AFTER_FIRST_UNLOCK has no value', async () => {
    const getItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
      typeof SecureStore.getItemAsync
    >;
    getItemAsync.mockImplementation(async (_key, options) => {
      if (options?.keychainAccessible === SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY) {
        return 'ccdd';
      }
      return null;
    });

    const loaded = await getSecretBytes('patria.device.private');
    expect(loaded && bytesToHex(loaded)).toBe('ccdd');
  });
});
