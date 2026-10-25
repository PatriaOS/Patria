// SECURITY REVIEW REQUIRED
import * as SecureStore from 'expo-secure-store';

import { secretsEqual, wipe } from './bytes';
import { generatePrintedCode } from './printedCode';
import { familyKeyStoreKey, recoveryKeyStoreKey } from './keyStore';
import { randomKey32 } from './random';
import { createRecoveryBoxes } from './recovery';
import {
  approveRecoveryAsContact,
  cancelledCopyKind,
  encodeHelperRewrapAad,
  finishLostPhoneRecovery,
  parsePrintedHelper,
  reconstructRecoveryKey,
  requestCanFinish,
  type RecoverFlowGateway,
  type RecoveryRequestRow,
} from './recoverFlow';
import { getSecretBytes } from './secureKeys';
import {
  unwrapKeyFromDevice,
  unwrapSecretWithAad,
  wrapFamilyKeyToRecoveryPublic,
  wrapKeyToDevice,
  wrapSecretWithAad,
} from './wrap';
import { generateDeviceKeyPair } from './x25519';

jest.mock('./personalKey', () => ({
  restorePersonalKeyFromRecovery: jest.fn(async () => undefined),
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';
const CONTACT = '44444444-4444-4444-4444-444444444444';
const ctx = { familySpaceId: SPACE, userId: USER, recoveryKeyEpoch: 1 };

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

function openRequest(overrides: Partial<RecoveryRequestRow> = {}): RecoveryRequestRow {
  const now = Date.now();
  return {
    id: 'r1',
    spaceId: SPACE,
    userId: USER,
    newDeviceId: 'd-new',
    newDeviceCreatedAt: new Date(now - 49 * 3600_000).toISOString(),
    startedAt: new Date(now - 49 * 3600_000).toISOString(),
    notBefore: new Date(now - 3600_000).toISOString(),
    expiresAt: new Date(now + 6 * 24 * 3600_000).toISOString(),
    cancelledAt: null,
    cancelledBy: null,
    completedAt: null,
    ...overrides,
  };
}

describe('lost-phone recovery reconstruct', () => {
  it('opens with A+B, A+code, and B+code, and fails with one helper or a bad word', () => {
    const recoveryKey = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const printed = generatePrintedCode();
    const boxes = createRecoveryBoxes(recoveryKey, secretA, secretB, printed.secret, ctx);

    expect(
      secretsEqual(reconstructRecoveryKey(boxes, { a: secretA, b: secretB }, ctx), recoveryKey),
    ).toBe(true);
    expect(
      secretsEqual(
        reconstructRecoveryKey(boxes, { a: secretA, p: parsePrintedHelper(printed.words) }, ctx),
        recoveryKey,
      ),
    ).toBe(true);
    expect(
      secretsEqual(
        reconstructRecoveryKey(boxes, { b: secretB, p: printed.secret }, ctx),
        recoveryKey,
      ),
    ).toBe(true);

    expect(() => reconstructRecoveryKey(boxes, { a: secretA }, ctx)).toThrow('unwrap failed');
    expect(() => reconstructRecoveryKey(boxes, { a: secretA, b: secretA }, ctx)).toThrow(
      'unwrap failed',
    );
    expect(() => parsePrintedHelper('not a mnemonic at all')).toThrow('printed code failed');
    expect(() =>
      reconstructRecoveryKey(boxes, { a: secretA, p: generatePrintedCode().secret }, ctx),
    ).toThrow('unwrap failed');
    wipe(recoveryKey);
  });

  it('labels cancel as you or a family admin', () => {
    expect(cancelledCopyKind(USER, USER)).toBe('you');
    expect(cancelledCopyKind('22222222-2222-2222-2222-222222222222', USER)).toBe('admin');
  });

  it('refuses finish while waiting or after expiry', () => {
    const waiting = openRequest({
      notBefore: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(requestCanFinish(waiting)).toBe(false);
    const expired = openRequest({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(requestCanFinish(expired)).toBe(false);
  });
});

describe('lost-phone recovery finish', () => {
  it('wraps the family key on the new phone and wipes the recovery private key', async () => {
    const store = new Map<string, string>();
    installMemoryStore(store);
    const recoveryPair = generateDeviceKeyPair();
    const familyKey = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const printed = generatePrintedCode();
    const boxes = createRecoveryBoxes(
      recoveryPair.privateKey,
      secretA,
      secretB,
      printed.secret,
      ctx,
    );
    const newDevice = generateDeviceKeyPair();
    const request = openRequest();
    const helperAad = encodeHelperRewrapAad({
      familySpaceId: SPACE,
      requestId: request.id,
      userId: USER,
      deviceId: request.newDeviceId,
    });
    const wrappedA = wrapSecretWithAad(secretA, newDevice.publicKey, helperAad);
    const inserts: { family?: Uint8Array } = {};
    const gateway: RecoverFlowGateway = {
      startRequest: async () => request.id,
      listRequests: async () => [request],
      cancelRequest: async () => undefined,
      fetchDevicePublicKey: async () => newDevice.publicKey,
      fetchOwnHolderSecret: async () => null,
      approveHelper: async () => undefined,
      listHelpers: async () => [{ slot: 'a', wrappedSecret: wrappedA }],
      fetchPairBoxes: async () => boxes,
      fetchSealedFamilyKeys: async () => [
        {
          keyEpoch: 1,
          sealed: wrapFamilyKeyToRecoveryPublic(familyKey, recoveryPair.publicKey, {
            familySpaceId: SPACE,
            keyEpoch: 1,
            userId: USER,
          }),
        },
      ],
      fetchMeta: async () => ({ keyEpoch: 1, recoveryKeyEpoch: 1 }),
      fetchRecoveryEpoch: async () => 1,
      insertFamilyWrap: async (row) => {
        inserts.family = row.wrappedKey;
      },
      completeRequest: async () => undefined,
      listRemovedNotices: async () => [],
    };

    await finishLostPhoneRecovery(
      {
        spaceId: SPACE,
        userId: USER,
        role: 'family_admin',
        deviceId: request.newDeviceId,
        privateKey: newDevice.privateKey,
        publicKey: newDevice.publicKey,
        request,
        paperWords: printed.words,
      },
      gateway,
    );

    const openedFamily = unwrapKeyFromDevice(inserts.family as Uint8Array, newDevice.privateKey, {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: USER,
      deviceId: request.newDeviceId,
    });
    expect(secretsEqual(openedFamily, familyKey)).toBe(true);
    const cachedFamily = await getSecretBytes(familyKeyStoreKey(USER, SPACE));
    const cachedRecovery = await getSecretBytes(recoveryKeyStoreKey(USER, SPACE));
    expect(cachedFamily && secretsEqual(cachedFamily, familyKey)).toBe(true);
    expect(cachedRecovery).toBeNull();
    wipe(openedFamily);
    wipe(familyKey);
  });

  it('clears typed paper words after a bad mnemonic without wrapping', async () => {
    let paper = 'abandon abandon';
    const gateway: RecoverFlowGateway = {
      startRequest: async () => 'r1',
      listRequests: async () => [],
      cancelRequest: async () => undefined,
      fetchDevicePublicKey: async () => new Uint8Array(32),
      fetchOwnHolderSecret: async () => null,
      approveHelper: async () => undefined,
      listHelpers: async () => [{ slot: 'a', wrappedSecret: new Uint8Array(80) }],
      fetchPairBoxes: async () => ({
        boxAb: new Uint8Array(80),
        boxAp: new Uint8Array(80),
        boxBp: new Uint8Array(80),
      }),
      fetchSealedFamilyKeys: async () => [],
      fetchMeta: async () => ({ keyEpoch: 1, recoveryKeyEpoch: 1 }),
      fetchRecoveryEpoch: async () => 1,
      insertFamilyWrap: async () => {
        throw new Error('must not wrap');
      },
      completeRequest: async () => {
        throw new Error('must not complete');
      },
      listRemovedNotices: async () => [],
    };
    await expect(
      finishLostPhoneRecovery(
        {
          spaceId: SPACE,
          userId: USER,
          role: 'elder',
          deviceId: 'd-new',
          privateKey: generateDeviceKeyPair().privateKey,
          publicKey: generateDeviceKeyPair().publicKey,
          request: openRequest(),
          paperWords: paper,
        },
        gateway,
      ),
    ).rejects.toThrow('printed code failed');
    paper = '';
    expect(paper).toBe('');
  });
});

describe('contact helper rewrap', () => {
  it('rewraps the holder secret to the new device with request AAD', async () => {
    const contact = generateDeviceKeyPair();
    const neu = generateDeviceKeyPair();
    const holder = randomKey32();
    const request = openRequest();
    const contactAad = {
      familySpaceId: SPACE,
      keyEpoch: 1,
      userId: CONTACT,
      deviceId: 'd-contact',
    };
    let approved: Uint8Array | undefined;
    const gateway: RecoverFlowGateway = {
      startRequest: async () => request.id,
      listRequests: async () => [request],
      cancelRequest: async () => undefined,
      fetchDevicePublicKey: async () => neu.publicKey,
      fetchOwnHolderSecret: async () => ({
        wrappedSecret: wrapKeyToDevice(holder, contact.publicKey, contactAad),
        recoveryKeyEpoch: 1,
        deviceId: 'd-contact',
      }),
      approveHelper: async (_id, _slot, wrapped) => {
        approved = wrapped;
      },
      listHelpers: async () => [],
      fetchPairBoxes: async () => null,
      fetchSealedFamilyKeys: async () => [],
      fetchMeta: async () => ({ keyEpoch: 1, recoveryKeyEpoch: 1 }),
      fetchRecoveryEpoch: async () => 1,
      insertFamilyWrap: async () => undefined,
      completeRequest: async () => undefined,
      listRemovedNotices: async () => [],
    };
    await approveRecoveryAsContact(
      {
        spaceId: SPACE,
        request,
        slot: 'b',
        contactUserId: CONTACT,
        contactDeviceId: 'd-contact',
        contactPrivateKey: contact.privateKey,
      },
      gateway,
    );
    const opened = unwrapSecretWithAad(
      approved as Uint8Array,
      neu.privateKey,
      encodeHelperRewrapAad({
        familySpaceId: SPACE,
        requestId: request.id,
        userId: USER,
        deviceId: request.newDeviceId,
      }),
    );
    expect(secretsEqual(opened, holder)).toBe(true);
    wipe(opened);
    wipe(holder);
  });
});
