import * as SecureStore from 'expo-secure-store';

import { eligibleRecoveryMembers } from './recoveryAccess';
import {
  approvedIdsFromEligibleContacts,
  fulfillAcceptedContacts,
  inviteRecoveryContacts,
  loadEligibleRecoveryContacts,
} from './recoverySetup';
import type { RecoveryAccessGateway, RecoveryContactRow } from './recoveryAccess';
import { createRecoveryBoxes, openWithHolders } from './recovery';
import { randomKey32 } from './random';
import { generatePrintedCode } from './printedCode';
import { secretsEqual, wipe } from './bytes';
import { generateDeviceKeyPair } from './x25519';

jest.mock('./deviceIdentity', () => {
  const x25519 = jest.requireActual('./x25519') as typeof import('./x25519');
  return {
    ensureDeviceIdentity: jest.fn(async () => {
      const keys = x25519.generateDeviceKeyPair();
      return { deviceId: 'd-rosa-setup', publicKey: keys.publicKey, privateKey: keys.privateKey };
    }),
  };
});

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ELENA = '11111111-1111-1111-1111-111111111111';
const MARCO = '22222222-2222-2222-2222-222222222222';
const ROSA = '44444444-4444-4444-4444-444444444444';
const JORDAN = '33333333-3333-3333-3333-333333333333';

function memoryGateway(contacts: RecoveryContactRow[] = []): RecoveryAccessGateway {
  return {
    fetchMeta: async () => ({ keyEpoch: 1, recoveryKeyEpoch: 1 }),
    fetchOwnRecoveryPublic: async () => null,
    listContacts: async () => contacts,
    inviteContact: async (input) => {
      contacts.push({
        id: `c-${contacts.length}`,
        spaceId: input.spaceId,
        memberId: input.memberId,
        userId: input.userId,
        slot: input.slot,
        status: 'pending',
      });
    },
    setContactStatus: async () => undefined,
    deleteContact: async () => undefined,
    listApprovedDevices: async () => [],
    listRecoveryContactPublicKeys: async () => [],
    listEligibleRecoveryContacts: async () => [],
    upsertFamilyKeyUnderRecovery: async () => undefined,
    insertRecoveryPublicKey: async () => undefined,
    insertHolderSecret: async () => undefined,
    insertPairWrap: async () => undefined,
    listPairIds: async () => [],
    fetchPairWraps: async () => [],
    purgeCiphertext: async () => undefined,
    hasOpenRecoveryRequest: async () => false,
    commitRecoveryRepair: async () => undefined,
    listHelperRefreshNotices: async () => [],
    dismissHelperRefreshNotice: async () => undefined,
  };
}

describe('recovery contact selection', () => {
  it('does not offer teens or members without a wrap', () => {
    const members = [
      { userId: ELENA, role: 'family_admin' as const },
      { userId: MARCO, role: 'co_admin' as const },
      { userId: ROSA, role: 'elder' as const },
      { userId: JORDAN, role: 'teen' as const },
    ];
    const approved = new Set([MARCO]);
    const eligible = eligibleRecoveryMembers(members, approved, ELENA);
    expect(eligible.map((row) => row.userId)).toEqual([MARCO]);
  });

  it('offers a let-in family admin when an elder is picking (D26)', async () => {
    const members = [
      { userId: ELENA, role: 'family_admin' as const },
      { userId: MARCO, role: 'co_admin' as const },
      { userId: ROSA, role: 'elder' as const },
      { userId: JORDAN, role: 'teen' as const },
    ];
    const gateway = memoryGateway();
    gateway.listEligibleRecoveryContacts = async () => [
      { userId: ELENA, displayName: 'Elena Rivera' },
      { userId: MARCO, displayName: 'Marco Rivera' },
    ];
    gateway.listApprovedDevices = async () => {
      throw new Error('picker must not list another member devices');
    };
    const contacts = await loadEligibleRecoveryContacts(SPACE, gateway);
    const eligible = eligibleRecoveryMembers(
      members,
      approvedIdsFromEligibleContacts(contacts),
      ROSA,
    );
    expect(eligible.map((row) => row.userId).sort()).toEqual([ELENA, MARCO].sort());
    expect(contacts.find((row) => row.userId === ELENA)?.displayName).toBe('Elena Rivera');
  });

  it('refuses to invite an ineligible member', async () => {
    await expect(
      inviteRecoveryContacts(
        {
          spaceId: SPACE,
          createdBy: ELENA,
          contactUserIds: [JORDAN],
          members: [
            { userId: ELENA, role: 'family_admin' },
            { userId: JORDAN, role: 'teen' },
          ],
          approvedUserIds: new Set([JORDAN]),
        },
        memoryGateway(),
      ),
    ).rejects.toThrow('ineligible recovery contact');
  });

  it('lets an elder finish recovery set up with Test 1 as an accepted contact', async () => {
    const store = new Map<string, string>();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      return store.get(key) ?? null;
    });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
    });
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      store.delete(key);
    });
    const elenaDevice = generateDeviceKeyPair();
    const rosaRecovery = generateDeviceKeyPair();
    const wrapped: { userId: string; deviceId: string }[] = [];
    const gateway = memoryGateway([
      {
        id: 'c-elena',
        spaceId: SPACE,
        memberId: ROSA,
        userId: ELENA,
        slot: 'a',
        status: 'accepted',
      },
    ]);
    gateway.fetchOwnRecoveryPublic = async () => ({
      publicKey: rosaRecovery.publicKey,
      recoveryKeyEpoch: 1,
    });
    gateway.listApprovedDevices = async () => {
      throw new Error('must not list approved_devices_for_member');
    };
    gateway.listRecoveryContactPublicKeys = async (_spaceId, contactUserId) => {
      expect(contactUserId).toBe(ELENA);
      return [{ deviceId: 'd-elena-1', publicKey: elenaDevice.publicKey }];
    };
    gateway.insertHolderSecret = async (input) => {
      wrapped.push({ userId: input.userId, deviceId: input.deviceId });
    };
    await fulfillAcceptedContacts({ spaceId: SPACE, memberUserId: ROSA }, gateway);
    expect(wrapped).toEqual([{ userId: ELENA, deviceId: 'd-elena-1' }]);
    wipe(elenaDevice.privateKey);
    wipe(rosaRecovery.privateKey);
  });
});

describe('recovery key rotation', () => {
  it('rebuilds boxes so old holder secrets cannot open the new recovery key', () => {
    const oldKey = randomKey32();
    const newKey = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const paper = generatePrintedCode();
    const ctxOld = { familySpaceId: SPACE, userId: ELENA, recoveryKeyEpoch: 1 };
    const ctxNew = { familySpaceId: SPACE, userId: ELENA, recoveryKeyEpoch: 2 };
    const oldBoxes = createRecoveryBoxes(oldKey, secretA, secretB, paper.secret, ctxOld);
    const newA = randomKey32();
    const newB = randomKey32();
    const newPaper = generatePrintedCode();
    const newBoxes = createRecoveryBoxes(newKey, newA, newB, newPaper.secret, ctxNew);
    const opened = openWithHolders(
      newBoxes,
      { id: 'a', secret: newA },
      { id: 'b', secret: newB },
      ctxNew,
    );
    expect(secretsEqual(opened, newKey)).toBe(true);
    expect(() =>
      openWithHolders(
        newBoxes,
        { id: 'a', secret: secretA },
        { id: 'b', secret: secretB },
        ctxNew,
      ),
    ).toThrow('unwrap failed');
    expect(() =>
      openWithHolders(
        oldBoxes,
        { id: 'a', secret: newA },
        { id: 'b', secret: newB },
        ctxOld,
      ),
    ).toThrow('unwrap failed');
    wipe(opened);
    wipe(oldKey);
    wipe(newKey);
  });
});
