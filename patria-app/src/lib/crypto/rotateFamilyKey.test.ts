// SECURITY REVIEW REQUIRED
import * as SecureStore from 'expo-secure-store';

import { secretsEqual, wipe } from './bytes';
import { ensureDeviceIdentity } from './deviceIdentity';
import { cacheFamilySecrets, familyKeyStoreKey, resetFamilyKeyMemory } from './keyStore';
import { randomKey32 } from './random';
import {
  homeRotationUiFromOutcome,
  rotateFamilyKeyIfNeeded,
  type RotateFamilyKeyGateway,
} from './rotateFamilyKey';
import { openVaultDecision, sealVaultDecision } from './vaultEnvelope';
import { unwrapFamilyKeyFromRecoveryPrivate, unwrapKeyFromDevice, wrapKeyToDevice } from './wrap';
import { generateDeviceKeyPair } from './x25519';
import { getSecretBytes } from './secureKeys';

jest.mock('./deviceAccess', () => ({
  supabaseDeviceAccessGateway: {
    fetchOwnWrap: jest.fn(),
  },
}));

import { supabaseDeviceAccessGateway } from './deviceAccess';

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = '11111111-1111-1111-1111-111111111111';
const ELDER = '44444444-4444-4444-4444-444444444444';

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

describe('rotate family key', () => {
  it('maps rotation outcomes to Home copy states', () => {
    expect(homeRotationUiFromOutcome('rotated')).toBe('upToDate');
    expect(homeRotationUiFromOutcome('alreadyCurrent')).toBe('upToDate');
    expect(homeRotationUiFromOutcome('failed')).toBe('failed');
    expect(homeRotationUiFromOutcome('idle')).toBe('hidden');
  });

  it('wraps remaining devices and seals remaining recovery public keys at the next epoch', async () => {
    const store = new Map<string, string>();
    installMemoryStore(store);
    resetFamilyKeyMemory();
    const adminDevice = await ensureDeviceIdentity(ADMIN);
    const elderDevice = generateDeviceKeyPair();
    const elderRecovery = generateDeviceKeyPair();
    const oldKey = randomKey32();
    const wrappedOld = wrapKeyToDevice(oldKey, adminDevice.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: ADMIN,
      deviceId: adminDevice.deviceId,
    });
    (supabaseDeviceAccessGateway.fetchOwnWrap as jest.Mock).mockResolvedValue({
      wrappedKey: wrappedOld,
      keyEpoch: 1,
    });
    await cacheFamilySecrets(ADMIN, SPACE, oldKey);
    const committed: {
      expectedEpoch?: number;
      deviceIds?: string[];
      sealUserIds?: string[];
      wrappedKeys?: Uint8Array[];
      sealedKeys?: Uint8Array[];
    } = {};
    const gateway: RotateFamilyKeyGateway = {
      fetchRotationNeeded: async () => ({ needed: true, keyEpoch: 1 }),
      listWrapTargets: async () => [
        {
          userId: ADMIN,
          deviceId: adminDevice.deviceId,
          publicKey: adminDevice.publicKey,
        },
        {
          userId: ELDER,
          deviceId: 'd-elder',
          publicKey: elderDevice.publicKey,
        },
      ],
      listSealTargets: async () => [
        { userId: ELDER, publicKey: elderRecovery.publicKey },
      ],
      listVaultCeks: async () => [],
      commitRotation: async (input) => {
        committed.expectedEpoch = input.expectedEpoch;
        committed.deviceIds = input.deviceIds;
        committed.sealUserIds = input.sealUserIds;
        committed.wrappedKeys = input.wrappedKeys;
        committed.sealedKeys = input.sealedKeys;
        return 2;
      },
    };

    const rotated = await rotateFamilyKeyIfNeeded(
      { spaceId: SPACE, userId: ADMIN, role: 'family_admin' },
      gateway,
    );
    expect(rotated).toBe('rotated');
    expect(committed.expectedEpoch).toBe(1);
    expect(committed.deviceIds).toEqual([adminDevice.deviceId, 'd-elder']);
    const newAdmin = unwrapKeyFromDevice(
      committed.wrappedKeys?.[0] as Uint8Array,
      adminDevice.privateKey,
      {
        familySpaceId: SPACE,
        keyEpoch: 2,
        userId: ADMIN,
        deviceId: adminDevice.deviceId,
      },
    );
    const newElder = unwrapKeyFromDevice(
      committed.wrappedKeys?.[1] as Uint8Array,
      elderDevice.privateKey,
      {
        familySpaceId: SPACE,
        keyEpoch: 2,
        userId: ELDER,
        deviceId: 'd-elder',
      },
    );
    expect(secretsEqual(newAdmin, newElder)).toBe(true);
    expect(secretsEqual(newAdmin, oldKey)).toBe(false);
    const openedSeal = unwrapFamilyKeyFromRecoveryPrivate(
      committed.sealedKeys?.[0] as Uint8Array,
      elderRecovery.privateKey,
      { familySpaceId: SPACE, keyEpoch: 2, userId: ELDER },
    );
    expect(secretsEqual(openedSeal, newAdmin)).toBe(true);
    const cached = await getSecretBytes(familyKeyStoreKey(ADMIN, SPACE));
    expect(cached && secretsEqual(cached, newAdmin)).toBe(true);
    wipe(oldKey);
    wipe(newAdmin);
    wipe(newElder);
    wipe(openedSeal);
  });

  it('does not rotate when a non-admin opens Home', async () => {
    const gateway: RotateFamilyKeyGateway = {
      fetchRotationNeeded: async () => ({ needed: true, keyEpoch: 1 }),
      listWrapTargets: async () => {
        throw new Error('must not list');
      },
      listSealTargets: async () => [],
      listVaultCeks: async () => {
        throw new Error('must not list vault');
      },
      commitRotation: async () => {
        throw new Error('must not commit');
      },
    };
    await expect(
      rotateFamilyKeyIfNeeded({ spaceId: SPACE, userId: ELDER, role: 'elder' }, gateway),
    ).resolves.toBe('idle');
  });

  it('treats a lost compare-and-swap as already up to date', async () => {
    const store = new Map<string, string>();
    installMemoryStore(store);
    resetFamilyKeyMemory();
    const adminDevice = await ensureDeviceIdentity(ADMIN);
    const oldKey = randomKey32();
    const wrappedOld = wrapKeyToDevice(oldKey, adminDevice.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: ADMIN,
      deviceId: adminDevice.deviceId,
    });
    (supabaseDeviceAccessGateway.fetchOwnWrap as jest.Mock).mockResolvedValue({
      wrappedKey: wrappedOld,
      keyEpoch: 1,
    });
    await cacheFamilySecrets(ADMIN, SPACE, oldKey);
    const gateway: RotateFamilyKeyGateway = {
      fetchRotationNeeded: jest
        .fn()
        .mockResolvedValueOnce({ needed: true, keyEpoch: 1 })
        .mockResolvedValueOnce({ needed: false, keyEpoch: 2 }),
      listWrapTargets: async () => [
        {
          userId: ADMIN,
          deviceId: adminDevice.deviceId,
          publicKey: adminDevice.publicKey,
        },
      ],
      listSealTargets: async () => [],
      listVaultCeks: async () => [],
      commitRotation: async () => {
        throw new Error('epoch mismatch');
      },
    };
    await expect(
      rotateFamilyKeyIfNeeded({ spaceId: SPACE, userId: ADMIN, role: 'family_admin' }, gateway),
    ).resolves.toBe('alreadyCurrent');
    wipe(oldKey);
  });

  it('rewraps vault CEKs in the same commit as the new family key', async () => {
    const store = new Map<string, string>();
    installMemoryStore(store);
    resetFamilyKeyMemory();
    const adminDevice = await ensureDeviceIdentity(ADMIN);
    const oldKey = randomKey32();
    const wrappedOld = wrapKeyToDevice(oldKey, adminDevice.publicKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: ADMIN,
      deviceId: adminDevice.deviceId,
    });
    (supabaseDeviceAccessGateway.fetchOwnWrap as jest.Mock).mockResolvedValue({
      wrappedKey: wrappedOld,
      keyEpoch: 1,
    });
    await cacheFamilySecrets(ADMIN, SPACE, oldKey);
    const entryId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const sealed = sealVaultDecision(
      oldKey,
      { title: 'We moved', body: 'For school.', for: 'Lily' },
      {
        familySpaceId: SPACE,
        entryId,
        version: 1,
        authorId: ADMIN,
        keyEpoch: 1,
      },
    );
    const committed: { entryIds?: string[]; wrappedCeks?: Uint8Array[]; cekNonces?: Uint8Array[] } =
      {};
    const gateway: RotateFamilyKeyGateway = {
      fetchRotationNeeded: async () => ({ needed: true, keyEpoch: 1 }),
      listWrapTargets: async () => [
        {
          userId: ADMIN,
          deviceId: adminDevice.deviceId,
          publicKey: adminDevice.publicKey,
        },
      ],
      listSealTargets: async () => [],
      listVaultCeks: async () => [
        {
          id: entryId,
          version: 1,
          keyEpoch: 1,
          cekNonce: sealed.cekNonce,
          wrappedCek: sealed.wrappedCek,
        },
      ],
      commitRotation: async (input) => {
        committed.entryIds = input.entryIds;
        committed.wrappedCeks = input.wrappedCeks;
        committed.cekNonces = input.cekNonces;
        return 2;
      },
    };
    await expect(
      rotateFamilyKeyIfNeeded({ spaceId: SPACE, userId: ADMIN, role: 'family_admin' }, gateway),
    ).resolves.toBe('rotated');
    expect(committed.entryIds).toEqual([entryId]);
    const cached = await getSecretBytes(familyKeyStoreKey(ADMIN, SPACE));
    expect(cached).toBeTruthy();
    const opened = openVaultDecision(
      cached as Uint8Array,
      {
        contentNonce: sealed.contentNonce,
        ciphertext: sealed.ciphertext,
        cekNonce: committed.cekNonces?.[0] as Uint8Array,
        wrappedCek: committed.wrappedCeks?.[0] as Uint8Array,
      },
      {
        familySpaceId: SPACE,
        entryId,
        version: 1,
        authorId: ADMIN,
        keyEpoch: 2,
      },
    );
    expect(opened.title).toBe('We moved');
    wipe(oldKey);
    if (cached) {
      wipe(cached);
    }
  });
});
