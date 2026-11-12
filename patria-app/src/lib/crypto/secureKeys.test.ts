import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  deleteSecret,
  getSecretBytes,
  getSecretText,
  secureStoreOptions,
  setSecretBytes,
  setSecretText,
} from './secureKeys';

describe('secure key storage', () => {
  beforeEach(() => {
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  });

  it('writes every secret with WHEN_UNLOCKED_THIS_DEVICE_ONLY only', async () => {
    const setItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
      typeof SecureStore.setItemAsync
    >;
    setItemAsync.mockResolvedValue(undefined);

    await setSecretBytes('patria.device.private', hexToBytes('aabb'));
    await setSecretText('patria.device.id', 'd1111111-1111-1111-1111-111111111111');
    await setSecretBytes('patria.u.u1.family.s1', hexToBytes('ccddee'));
    await setSecretBytes('patria.u.u1.personal.s1', hexToBytes('ff0011'));
    await setSecretBytes('patria.u.u1.letterbox.s1', hexToBytes('223344'));

    expect(setItemAsync.mock.calls.length).toBe(5);
    for (const call of setItemAsync.mock.calls) {
      expect(call[2]).toEqual({
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    expect(secureStoreOptions().keychainAccessible).toBe(
      SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    );
    expect(
      setItemAsync.mock.calls.some(
        (call) => call[2]?.keychainAccessible === SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      ),
    ).toBe(false);
  });

  it('reads and deletes with the same WHEN_UNLOCKED class', async () => {
    const getItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
      typeof SecureStore.getItemAsync
    >;
    const deleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
      typeof SecureStore.deleteItemAsync
    >;
    getItemAsync.mockResolvedValue('aabb');
    deleteItemAsync.mockResolvedValue(undefined);

    const loaded = await getSecretBytes('patria.device.private');
    expect(loaded && bytesToHex(loaded)).toBe('aabb');
    expect(getItemAsync).toHaveBeenCalledWith('patria.device.private', {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(getItemAsync).toHaveBeenCalledTimes(1);

    await getSecretText('patria.device.id');
    await deleteSecret('patria.device.private');
    expect(deleteItemAsync).toHaveBeenCalledWith('patria.device.private', {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
});
