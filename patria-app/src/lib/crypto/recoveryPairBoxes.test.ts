import * as SecureStore from 'expo-secure-store';

import { wipe } from './bytes';
import { generatePrintedCode, pickPrintedCodeChecks } from './printedCode';
import { createRecoveryBoxes, openWithHolders } from './recovery';
import type { RecoveryAccessGateway, RecoveryContactRow } from './recoveryAccess';
import { randomKey32 } from './random';
import {
  fulfillAcceptedContacts,
  recoveryPrivateStoreKey,
  recoveryStatusCopyKey,
  repairRecoverySetup,
  savePrintedCode,
  type RecoverySnapshot,
} from './recoverySetup';
import { getSecretBytes, setSecretBytes } from './secureKeys';
import { generateDeviceKeyPair } from './x25519';

jest.mock('./deviceIdentity', () => {
  const x25519 = jest.requireActual('./x25519') as typeof import('./x25519');
  return {
    ensureDeviceIdentity: jest.fn(async () => {
      const keys = x25519.generateDeviceKeyPair();
      return {
        deviceId: 'd-member-1',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      };
    }),
  };
});

jest.mock('./keyStore', () => ({
  obtainFamilyKey: jest.fn(async () => {
    const { randomKey32: rand } = jest.requireActual('./random') as typeof import('./random');
    return rand();
  }),
}));

jest.mock('./personalKey', () => ({
  personalSealForRecoveryChange: jest.fn(async () => null),
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER = '44444444-4444-4444-4444-444444444444';
const CONTACT_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_B = '22222222-2222-2222-2222-222222222222';

function memoryStore() {
  const store = new Map<string, string>();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    async (key: string, value: string) => {
      store.set(key, value);
    },
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
}

type Harness = {
  gateway: RecoveryAccessGateway;
  pairIds: Map<number, Set<string>>;
  commits: { count: number };
  published: { current: { publicKey: Uint8Array; recoveryKeyEpoch: number } | null };
};

function makeHarness(contacts: RecoveryContactRow[]): Harness {
  const pairIds = new Map<number, Set<string>>();
  const commits = { count: 0 };
  const published: Harness['published'] = { current: null };
  const contactA = generateDeviceKeyPair();
  const contactB = generateDeviceKeyPair();
  const gateway: RecoveryAccessGateway = {
    fetchMeta: async () => ({ keyEpoch: 1, recoveryKeyEpoch: 1 }),
    fetchOwnRecoveryPublic: async () => published.current,
    listContacts: async () => contacts,
    inviteContact: async () => undefined,
    setContactStatus: async () => undefined,
    deleteContact: async () => undefined,
    listApprovedDevices: async () => [],
    listRecoveryContactPublicKeys: async (_space, contactUserId) => {
      if (contactUserId === CONTACT_A) {
        return [{ deviceId: 'd-a', publicKey: contactA.publicKey }];
      }
      return [{ deviceId: 'd-b', publicKey: contactB.publicKey }];
    },
    listEligibleRecoveryContacts: async () => [],
    upsertFamilyKeyUnderRecovery: async () => undefined,
    insertRecoveryPublicKey: async (input) => {
      published.current = {
        publicKey: input.publicKey,
        recoveryKeyEpoch: input.recoveryKeyEpoch,
      };
    },
    insertHolderSecret: async () => undefined,
    insertPairWrap: async (input) => {
      const set = pairIds.get(input.recoveryKeyEpoch) ?? new Set<string>();
      set.add(input.pairId);
      pairIds.set(input.recoveryKeyEpoch, set);
    },
    listPairIds: async (_space, _user, epoch) => [...(pairIds.get(epoch) ?? [])],
    fetchPairWraps: async () => [],
    purgeCiphertext: async () => undefined,
    hasOpenRecoveryRequest: async () => false,
    commitRecoveryRepair: async (input) => {
      commits.count += 1;
      published.current = {
        publicKey: input.publicKey,
        recoveryKeyEpoch: input.newEpoch,
      };
      const set = pairIds.get(input.newEpoch) ?? new Set<string>();
      set.add('ab');
      pairIds.set(input.newEpoch, set);
      pairIds.delete(input.oldEpoch);
    },
    listHelperRefreshNotices: async () => [],
    dismissHelperRefreshNotice: async () => undefined,
  };
  return { gateway, pairIds, commits, published };
}

describe('recovery pair boxes status', () => {
  it('marks one accepted contact as one_of_two even when recovery public exists', () => {
    const snapshot: Omit<RecoverySnapshot, 'status'> = {
      contacts: [],
      ownContacts: [
        {
          id: '1',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_A,
          slot: 'a',
          status: 'accepted',
        },
      ],
      accepted: 1,
      pending: [],
      hasAb: false,
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
    };
    expect(recoveryStatusCopyKey(snapshot, MEMBER, 'family_admin')).toBe('one_of_two');
  });

  it('marks one contact left after ab as needs_attention (removed a helper)', () => {
    const snapshot: Omit<RecoverySnapshot, 'status'> = {
      contacts: [],
      ownContacts: [
        {
          id: '1',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_A,
          slot: 'a',
          status: 'accepted',
        },
      ],
      accepted: 1,
      pending: [],
      hasAb: true,
      hasPaper: true,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
    };
    expect(recoveryStatusCopyKey(snapshot, MEMBER, 'family_admin')).toBe('needs_attention');
  });

  it('marks orphan recovery public with no contacts as needs_attention', () => {
    const snapshot: Omit<RecoverySnapshot, 'status'> = {
      contacts: [],
      ownContacts: [],
      accepted: 0,
      pending: [],
      hasAb: false,
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
    };
    expect(recoveryStatusCopyKey(snapshot, MEMBER, 'family_admin')).toBe('needs_attention');
  });

  it('marks two contacts with no ab as needs_attention, never setup', () => {
    const snapshot: Omit<RecoverySnapshot, 'status'> = {
      contacts: [],
      ownContacts: [
        {
          id: '1',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_A,
          slot: 'a',
          status: 'accepted',
        },
        {
          id: '2',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_B,
          slot: 'b',
          status: 'accepted',
        },
      ],
      accepted: 2,
      pending: [],
      hasAb: false,
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
    };
    expect(recoveryStatusCopyKey(snapshot, MEMBER, 'family_admin')).toBe('needs_attention');
  });

  it('marks ab without paper as almost_done', () => {
    const snapshot: Omit<RecoverySnapshot, 'status'> = {
      contacts: [],
      ownContacts: [
        {
          id: '1',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_A,
          slot: 'a',
          status: 'accepted',
        },
        {
          id: '2',
          spaceId: SPACE,
          memberId: MEMBER,
          userId: CONTACT_B,
          slot: 'b',
          status: 'accepted',
        },
      ],
      accepted: 2,
      pending: [],
      hasAb: true,
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
    };
    expect(recoveryStatusCopyKey(snapshot, MEMBER, 'family_admin')).toBe('almost_done');
  });
});

describe('staggered contact acceptance writes ab', () => {
  it('writes ab only after the second contact accepts', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    await fulfillAcceptedContacts(
      { spaceId: SPACE, memberUserId: MEMBER },
      harness.gateway,
    );
    expect([...(harness.pairIds.get(1) ?? [])]).toEqual([]);

    contacts.push({
      id: 'c-b',
      spaceId: SPACE,
      memberId: MEMBER,
      userId: CONTACT_B,
      slot: 'b',
      status: 'accepted',
    });
    await fulfillAcceptedContacts(
      { spaceId: SPACE, memberUserId: MEMBER },
      harness.gateway,
    );
    expect([...(harness.pairIds.get(1) ?? [])]).toEqual(['ab']);
  });

  it('stores recovery private with WHEN_UNLOCKED_THIS_DEVICE_ONLY and deletes it once ab is saved', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    const privateKey = recoveryPrivateStoreKey(MEMBER, SPACE);

    await fulfillAcceptedContacts(
      { spaceId: SPACE, memberUserId: MEMBER },
      harness.gateway,
    );
    expect(await getSecretBytes(privateKey)).not.toBeNull();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      privateKey,
      expect.any(String),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    contacts.push({
      id: 'c-b',
      spaceId: SPACE,
      memberId: MEMBER,
      userId: CONTACT_B,
      slot: 'b',
      status: 'accepted',
    });
    await fulfillAcceptedContacts(
      { spaceId: SPACE, memberUserId: MEMBER },
      harness.gateway,
    );
    expect([...(harness.pairIds.get(1) ?? [])]).toEqual(['ab']);
    expect(await getSecretBytes(privateKey)).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(privateKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
});

describe('repairRecoverySetup', () => {
  it('refuses while a recovery request is open', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
      {
        id: 'c-b',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_B,
        slot: 'b',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    harness.gateway.hasOpenRecoveryRequest = async () => true;
    await expect(
      repairRecoverySetup({ spaceId: SPACE, memberUserId: MEMBER }, harness.gateway),
    ).rejects.toThrow('recovery request open');
    expect(harness.commits.count).toBe(0);
  });

  it('commits a new epoch with ab when repair succeeds', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
      {
        id: 'c-b',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_B,
        slot: 'b',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    harness.published.current = {
      publicKey: generateDeviceKeyPair().publicKey,
      recoveryKeyEpoch: 1,
    };
    await repairRecoverySetup({ spaceId: SPACE, memberUserId: MEMBER }, harness.gateway);
    expect(harness.commits.count).toBe(1);
    expect([...(harness.pairIds.get(2) ?? [])]).toEqual(['ab']);
  });

  it('leaves the old epoch when commit fails midway', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
      {
        id: 'c-b',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_B,
        slot: 'b',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    const oldPub = generateDeviceKeyPair().publicKey;
    harness.published.current = { publicKey: oldPub, recoveryKeyEpoch: 1 };
    harness.pairIds.set(1, new Set(['ab', 'ap', 'bp']));
    harness.gateway.commitRecoveryRepair = async () => {
      throw new Error('simulated mid-commit failure');
    };
    await expect(
      repairRecoverySetup({ spaceId: SPACE, memberUserId: MEMBER }, harness.gateway),
    ).rejects.toThrow('simulated mid-commit failure');
    expect(harness.published.current?.recoveryKeyEpoch).toBe(1);
    expect(harness.published.current?.publicKey).toBe(oldPub);
    expect([...(harness.pairIds.get(1) ?? [])].sort()).toEqual(['ab', 'ap', 'bp']);
    expect(harness.pairIds.has(2)).toBe(false);
  });

  it('lets contacts open the new ab with A and B after repair', async () => {
    memoryStore();
    const contacts: RecoveryContactRow[] = [
      {
        id: 'c-a',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_A,
        slot: 'a',
        status: 'accepted',
      },
      {
        id: 'c-b',
        spaceId: SPACE,
        memberId: MEMBER,
        userId: CONTACT_B,
        slot: 'b',
        status: 'accepted',
      },
    ];
    const harness = makeHarness(contacts);
    harness.published.current = {
      publicKey: generateDeviceKeyPair().publicKey,
      recoveryKeyEpoch: 1,
    };
    const secure = jest.requireActual('./secureKeys') as typeof import('./secureKeys');
    let abBox: Uint8Array | null = null;
    harness.gateway.commitRecoveryRepair = async (input) => {
      harness.commits.count += 1;
      abBox = new Uint8Array(input.abBox);
      harness.published.current = {
        publicKey: input.publicKey,
        recoveryKeyEpoch: input.newEpoch,
      };
      const set = harness.pairIds.get(input.newEpoch) ?? new Set<string>();
      set.add('ab');
      harness.pairIds.set(input.newEpoch, set);
      harness.pairIds.delete(input.oldEpoch);
    };
    await repairRecoverySetup({ spaceId: SPACE, memberUserId: MEMBER }, harness.gateway);
    const secretA = await secure.getSecretBytes(`patria.u.${MEMBER}.holder.${SPACE}.a`);
    const secretB = await secure.getSecretBytes(`patria.u.${MEMBER}.holder.${SPACE}.b`);
    expect(abBox).not.toBeNull();
    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();
    const opened = openWithHolders(
      {
        boxAb: abBox!,
        boxAp: new Uint8Array(80),
        boxBp: new Uint8Array(80),
      },
      { id: 'a', secret: secretA! },
      { id: 'b', secret: secretB! },
      {
        familySpaceId: SPACE,
        userId: MEMBER,
        recoveryKeyEpoch: harness.published.current!.recoveryKeyEpoch,
      },
    );
    expect(opened.length).toBe(32);
    wipe(opened);
    wipe(secretA!);
    wipe(secretB!);
    wipe(abBox!);
  });
});

describe('savePrintedCode writes ap and bp', () => {
  it('requires ab and verifies ap and bp after save', async () => {
    memoryStore();
    const recoveryKey = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const printed = generatePrintedCode();
    const ctx = {
      familySpaceId: SPACE,
      userId: MEMBER,
      recoveryKeyEpoch: 1,
    };
    const boxes = createRecoveryBoxes(recoveryKey, secretA, secretB, printed.secret, ctx);
    await setSecretBytes(`patria.u.${MEMBER}.holder.${SPACE}.a`, secretA);
    await setSecretBytes(`patria.u.${MEMBER}.holder.${SPACE}.b`, secretB);

    const pairIds = new Set<string>(['ab']);
    const wraps = new Map<string, Uint8Array>([['ab', boxes.boxAb]]);
    const harness = makeHarness([]);
    harness.gateway.fetchOwnRecoveryPublic = async () => ({
      publicKey: generateDeviceKeyPair().publicKey,
      recoveryKeyEpoch: 1,
    });
    harness.gateway.fetchPairWraps = async () =>
      [...wraps.entries()].map(([pairId, wrappedRecoveryKey]) => ({
        pairId,
        wrappedRecoveryKey,
      }));
    harness.gateway.listPairIds = async () => [...pairIds];
    harness.gateway.insertPairWrap = async (input) => {
      pairIds.add(input.pairId);
      wraps.set(input.pairId, input.wrappedRecoveryKey);
    };

    const picked = pickPrintedCodeChecks(printed.words);
    const words = printed.words.split(/\s+/);
    await savePrintedCode(
      {
        spaceId: SPACE,
        memberUserId: MEMBER,
        printed,
        answers: picked.map((item) => ({
          index: item.index,
          word: words[item.index] ?? '',
        })),
      },
      harness.gateway,
    );
    expect(pairIds.has('ap')).toBe(true);
    expect(pairIds.has('bp')).toBe(true);
    const opened = openWithHolders(
      {
        boxAb: wraps.get('ab')!,
        boxAp: wraps.get('ap')!,
        boxBp: wraps.get('bp')!,
      },
      { id: 'a', secret: secretA },
      { id: 'p', secret: printed.secret },
      ctx,
    );
    expect(opened.length).toBe(32);
    wipe(opened);
    wipe(recoveryKey);
    wipe(secretA);
    wipe(secretB);
  });
});
