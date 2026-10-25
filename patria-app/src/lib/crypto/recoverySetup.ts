// SECURITY REVIEW REQUIRED
import { logKeyStep } from '../devLog';
import { isKeyEligibleRole, type SpaceRole } from '../roles';
import { wipe } from './bytes';
import { supabaseDeviceAccessGateway } from './deviceAccess';
import { ensureDeviceIdentity } from './deviceIdentity';
import { obtainFamilyKey } from './keyStore';
import { requireX25519PublicKey } from './pgBytea';
import { personalSealForRecoveryChange } from './personalKey';
import {
  generatePrintedCode,
  printedChecksMatch,
  type PrintedCode,
} from './printedCode';
import { randomKey32 } from './random';
import {
  createRecoveryBoxes,
  openRecoveryPair,
  type RecoveryBoxes,
} from './recovery';
import {
  eligibleRecoveryMembers,
  supabaseRecoveryAccessGateway,
  type RecoveryAccessGateway,
  type RecoveryContactRow,
  type RecoverySlot,
} from './recoveryAccess';
import { deleteSecret, getSecretBytes, setSecretBytes } from './secureKeys';
import { wrapFamilyKeyToRecoveryPublic, wrapKeyToDevice, type MemberWrapAad } from './wrap';
import { generateDeviceKeyPair } from './x25519';

export type RecoveryHomeStatus =
  | 'not_setup'
  | 'one_of_two'
  | 'setup'
  | 'needs_attention'
  | 'contact';

export type RecoverySnapshot = {
  contacts: RecoveryContactRow[];
  ownContacts: RecoveryContactRow[];
  accepted: number;
  pending: RecoveryContactRow[];
  hasPaper: boolean;
  hasRecoveryPublic: boolean;
  recoveryKeyEpoch: number;
  keyEpoch: number;
  status: RecoveryHomeStatus;
};

function holderStoreKey(userId: string, spaceId: string, slot: RecoverySlot): string {
  return `patria.u.${userId}.holder.${spaceId}.${slot}`;
}

function wrapAad(input: {
  spaceId: string;
  epoch: number;
  userId: string;
  deviceId: string;
}): MemberWrapAad {
  return {
    familySpaceId: input.spaceId,
    keyEpoch: input.epoch,
    userId: input.userId,
    deviceId: input.deviceId,
  };
}

export function recoveryStatusCopyKey(
  snapshot: Omit<RecoverySnapshot, 'status'>,
  userId: string,
  role: string | null | undefined,
): RecoveryHomeStatus {
  if (snapshot.ownContacts.some((row) => row.status === 'accepted') === false) {
    const asContact = snapshot.contacts.find(
      (row) => row.userId === userId && row.status === 'accepted' && row.memberId !== userId,
    );
    if (asContact && !isKeyEligibleRole(role)) {
      return 'contact';
    }
  }
  if (snapshot.accepted >= 2) {
    return 'setup';
  }
  if (snapshot.hasRecoveryPublic && snapshot.accepted < 2) {
    return 'needs_attention';
  }
  if (snapshot.accepted === 1) {
    return 'one_of_two';
  }
  const asContact = snapshot.contacts.find(
    (row) => row.userId === userId && row.status === 'accepted' && row.memberId !== userId,
  );
  if (asContact && snapshot.accepted === 0) {
    return 'contact';
  }
  return 'not_setup';
}

export async function loadRecoverySnapshot(
  spaceId: string,
  userId: string,
  role: string | null | undefined,
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<RecoverySnapshot> {
  const meta = await gateway.fetchMeta(spaceId);
  const contacts = await gateway.listContacts(spaceId);
  const ownContacts = contacts.filter((row) => row.memberId === userId);
  const accepted = ownContacts.filter((row) => row.status === 'accepted').length;
  const ownPublic = await gateway.fetchOwnRecoveryPublic(spaceId, userId);
  const recoveryKeyEpoch = ownPublic?.recoveryKeyEpoch ?? meta?.recoveryKeyEpoch ?? 1;
  const pairIds = meta
    ? await gateway.listPairIds(spaceId, userId, recoveryKeyEpoch)
    : [];
  const snapshot: RecoverySnapshot = {
    contacts,
    ownContacts,
    accepted,
    pending: contacts.filter((row) => row.userId === userId && row.status === 'pending'),
    hasPaper: pairIds.includes('ap') && pairIds.includes('bp'),
    hasRecoveryPublic: ownPublic !== null,
    recoveryKeyEpoch,
    keyEpoch: meta?.keyEpoch ?? 1,
    status: 'not_setup',
  };
  snapshot.status = recoveryStatusCopyKey(snapshot, userId, role);
  return snapshot;
}

export function selectableRecoveryContacts(
  members: { userId: string; role: SpaceRole }[],
  approvedUserIds: Set<string>,
  pickerUserId: string,
): { userId: string; role: SpaceRole }[] {
  return eligibleRecoveryMembers(members, approvedUserIds, pickerUserId);
}

async function sealFamilyUnderRecovery(
  input: {
    spaceId: string;
    userId: string;
    deviceId: string;
    privateKey: Uint8Array;
    recoveryPublicKey: Uint8Array;
    keyEpoch: number;
  },
  gateway: RecoveryAccessGateway,
): Promise<void> {
  const familyKey = await obtainFamilyKey({
    userId: input.userId,
    spaceId: input.spaceId,
    deviceId: input.deviceId,
    privateKey: input.privateKey,
    fetchOwnWrap: supabaseDeviceAccessGateway.fetchOwnWrap,
  });
  if (!familyKey) {
    throw new Error('missing family key');
  }
  try {
    const wrapped = wrapFamilyKeyToRecoveryPublic(familyKey, input.recoveryPublicKey, {
      familySpaceId: input.spaceId,
      keyEpoch: input.keyEpoch,
      userId: input.userId,
    });
    await gateway.upsertFamilyKeyUnderRecovery({
      spaceId: input.spaceId,
      userId: input.userId,
      keyEpoch: input.keyEpoch,
      wrappedFamilyKey: wrapped,
    });
  } finally {
    wipe(familyKey);
  }
}

export async function inviteRecoveryContacts(
  input: {
    spaceId: string;
    createdBy: string;
    contactUserIds: [string, string] | [string];
    members: { userId: string; role: SpaceRole }[];
    approvedUserIds: Set<string>;
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  const allowed = selectableRecoveryContacts(
    input.members,
    input.approvedUserIds,
    input.createdBy,
  );
  const allowedIds = new Set(allowed.map((row) => row.userId));
  for (const userId of input.contactUserIds) {
    if (!allowedIds.has(userId)) {
      throw new Error('ineligible recovery contact');
    }
  }
  const existing = (await gateway.listContacts(input.spaceId)).filter(
    (row) => row.memberId === input.createdBy,
  );
  const usedSlots = new Set(
    existing.filter((row) => row.status !== 'declined').map((row) => row.slot),
  );
  const slots: RecoverySlot[] = [];
  if (!usedSlots.has('a')) {
    slots.push('a');
  }
  if (!usedSlots.has('b')) {
    slots.push('b');
  }
  if (slots.length < input.contactUserIds.length) {
    throw new Error('recovery slots full');
  }
  for (let i = 0; i < input.contactUserIds.length; i += 1) {
    await gateway.inviteContact({
      spaceId: input.spaceId,
      memberId: input.createdBy,
      userId: input.contactUserIds[i],
      slot: slots[i],
      createdBy: input.createdBy,
    });
  }
}

export async function respondRecoveryInvite(
  input: { spaceId: string; userId: string; accept: boolean },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  await gateway.setContactStatus(
    input.spaceId,
    input.userId,
    input.accept ? 'accepted' : 'declined',
  );
}

async function wrapHolderToDevices(
  input: {
    spaceId: string;
    memberId: string;
    userId: string;
    secret: Uint8Array;
    recoveryKeyEpoch: number;
  },
  gateway: RecoveryAccessGateway,
): Promise<void> {
  const devices = await gateway.listRecoveryContactPublicKeys(input.spaceId, input.userId);
  for (const device of devices) {
    const publicKey = requireX25519PublicKey(device.publicKey);
    const wrapped = wrapKeyToDevice(
      input.secret,
      publicKey,
      wrapAad({
        spaceId: input.spaceId,
        epoch: input.recoveryKeyEpoch,
        userId: input.userId,
        deviceId: device.deviceId,
      }),
    );
    await gateway.insertHolderSecret({
      spaceId: input.spaceId,
      memberId: input.memberId,
      userId: input.userId,
      deviceId: device.deviceId,
      wrappedSecret: wrapped,
      recoveryKeyEpoch: input.recoveryKeyEpoch,
    });
  }
}

export async function fulfillAcceptedContacts(
  input: {
    spaceId: string;
    memberUserId: string;
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  const device = await ensureDeviceIdentity(input.memberUserId);
  const meta = await gateway.fetchMeta(input.spaceId);
  if (!meta) {
    throw new Error('missing family key');
  }
  let published = await gateway.fetchOwnRecoveryPublic(input.spaceId, input.memberUserId);
  const pair = published ? null : generateDeviceKeyPair();
  const recoveryKeyEpoch = published?.recoveryKeyEpoch ?? 1;
  const recoveryPublic = published?.publicKey ?? pair!.publicKey;
  const recoveryPrivate = pair?.privateKey;
  try {
    if (pair) {
      await gateway.insertRecoveryPublicKey({
        spaceId: input.spaceId,
        userId: input.memberUserId,
        publicKey: pair.publicKey,
        recoveryKeyEpoch,
      });
      await sealFamilyUnderRecovery(
        {
          spaceId: input.spaceId,
          userId: input.memberUserId,
          deviceId: device.deviceId,
          privateKey: device.privateKey,
          recoveryPublicKey: recoveryPublic,
          keyEpoch: meta.keyEpoch,
        },
        gateway,
      );
    }
    const contacts = (await gateway.listContacts(input.spaceId)).filter(
      (row) => row.memberId === input.memberUserId && row.status === 'accepted',
    );
    for (const contact of contacts) {
      const stored = await getSecretBytes(
        holderStoreKey(input.memberUserId, input.spaceId, contact.slot),
      );
      if (stored) {
        wipe(stored);
        continue;
      }
      const secret = randomKey32();
      try {
        await setSecretBytes(
          holderStoreKey(input.memberUserId, input.spaceId, contact.slot),
          secret,
        );
        await wrapHolderToDevices(
          {
            spaceId: input.spaceId,
            memberId: input.memberUserId,
            userId: contact.userId,
            secret,
            recoveryKeyEpoch,
          },
          gateway,
        );
      } finally {
        wipe(secret);
      }
    }
    if (recoveryPrivate) {
      await rebuildPairBoxes(
        {
          spaceId: input.spaceId,
          memberUserId: input.memberUserId,
          recoveryKey: recoveryPrivate,
          recoveryKeyEpoch,
          paper: null,
        },
        gateway,
      );
    }
  } finally {
    if (recoveryPrivate) {
      wipe(recoveryPrivate);
    }
  }
}

async function loadHolder(
  memberUserId: string,
  spaceId: string,
  slot: RecoverySlot,
): Promise<Uint8Array | null> {
  return getSecretBytes(holderStoreKey(memberUserId, spaceId, slot));
}

async function rebuildPairBoxes(
  input: {
    spaceId: string;
    memberUserId: string;
    recoveryKey: Uint8Array;
    recoveryKeyEpoch: number;
    paper: Uint8Array | null;
  },
  gateway: RecoveryAccessGateway,
): Promise<RecoveryBoxes | null> {
  const secretA = await loadHolder(input.memberUserId, input.spaceId, 'a');
  const secretB = await loadHolder(input.memberUserId, input.spaceId, 'b');
  if (!secretA || !secretB) {
    if (secretA) {
      wipe(secretA);
    }
    if (secretB) {
      wipe(secretB);
    }
    return null;
  }
  const paper = input.paper ?? randomKey32();
  const generatedPaper = !input.paper;
  try {
    const ctx = {
      familySpaceId: input.spaceId,
      userId: input.memberUserId,
      recoveryKeyEpoch: input.recoveryKeyEpoch,
    };
    const boxes = createRecoveryBoxes(input.recoveryKey, secretA, secretB, paper, ctx);
    const existing = await gateway.listPairIds(
      input.spaceId,
      input.memberUserId,
      input.recoveryKeyEpoch,
    );
    if (!existing.includes('ab')) {
      await gateway.insertPairWrap({
        spaceId: input.spaceId,
        userId: input.memberUserId,
        recoveryKeyEpoch: input.recoveryKeyEpoch,
        pairId: 'ab',
        wrappedRecoveryKey: boxes.boxAb,
      });
    }
    if (!generatedPaper) {
      if (!existing.includes('ap')) {
        await gateway.insertPairWrap({
          spaceId: input.spaceId,
          userId: input.memberUserId,
          recoveryKeyEpoch: input.recoveryKeyEpoch,
          pairId: 'ap',
          wrappedRecoveryKey: boxes.boxAp,
        });
      }
      if (!existing.includes('bp')) {
        await gateway.insertPairWrap({
          spaceId: input.spaceId,
          userId: input.memberUserId,
          recoveryKeyEpoch: input.recoveryKeyEpoch,
          pairId: 'bp',
          wrappedRecoveryKey: boxes.boxBp,
        });
      }
    }
    return boxes;
  } finally {
    wipe(secretA);
    wipe(secretB);
    if (generatedPaper) {
      wipe(paper);
    }
  }
}

export function confirmPrintedCodeLocally(
  recoveryKey: Uint8Array,
  secretA: Uint8Array,
  secretB: Uint8Array,
  printed: PrintedCode,
  ctx: { familySpaceId: string; userId: string; recoveryKeyEpoch: number },
  answers: { index: number; word: string }[],
): RecoveryBoxes {
  if (!printedChecksMatch(printed.words, answers)) {
    throw new Error('printed code failed');
  }
  const boxes = createRecoveryBoxes(
    recoveryKey,
    secretA,
    secretB,
    printed.secret,
    ctx,
  );
  const opened = openRecoveryPair(boxes.boxAp, secretA, printed.secret, ctx, 'ap');
  wipe(opened);
  return boxes;
}

export async function savePrintedCode(
  input: {
    spaceId: string;
    memberUserId: string;
    printed: PrintedCode;
    answers: { index: number; word: string }[];
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  const published = await gateway.fetchOwnRecoveryPublic(input.spaceId, input.memberUserId);
  if (!published) {
    throw new Error('missing recovery public key');
  }
  const secretA = await loadHolder(input.memberUserId, input.spaceId, 'a');
  const secretB = await loadHolder(input.memberUserId, input.spaceId, 'b');
  if (!secretA || !secretB) {
    if (secretA) {
      wipe(secretA);
    }
    if (secretB) {
      wipe(secretB);
    }
    throw new Error('missing holder secret');
  }
  const wraps = await gateway.fetchPairWraps(
    input.spaceId,
    input.memberUserId,
    published.recoveryKeyEpoch,
  );
  const ab = wraps.find((row) => row.pairId === 'ab');
  if (!ab) {
    wipe(secretA);
    wipe(secretB);
    throw new Error('missing pair box');
  }
  const ctx = {
    familySpaceId: input.spaceId,
    userId: input.memberUserId,
    recoveryKeyEpoch: published.recoveryKeyEpoch,
  };
  const recoveryPrivate = openRecoveryPair(ab.wrappedRecoveryKey, secretA, secretB, ctx, 'ab');
  try {
    const boxes = confirmPrintedCodeLocally(
      recoveryPrivate,
      secretA,
      secretB,
      input.printed,
      ctx,
      input.answers,
    );
    await gateway.insertPairWrap({
      spaceId: input.spaceId,
      userId: input.memberUserId,
      recoveryKeyEpoch: published.recoveryKeyEpoch,
      pairId: 'ap',
      wrappedRecoveryKey: boxes.boxAp,
    });
    await gateway.insertPairWrap({
      spaceId: input.spaceId,
      userId: input.memberUserId,
      recoveryKeyEpoch: published.recoveryKeyEpoch,
      pairId: 'bp',
      wrappedRecoveryKey: boxes.boxBp,
    });
  } finally {
    wipe(secretA);
    wipe(secretB);
    wipe(recoveryPrivate);
  }
}

export async function removeRecoveryContact(
  input: { spaceId: string; contactUserId: string },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  await gateway.deleteContact(input.spaceId, input.contactUserId);
}

export async function rotateRecoveryKey(
  input: {
    spaceId: string;
    memberUserId: string;
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  const published = await gateway.fetchOwnRecoveryPublic(input.spaceId, input.memberUserId);
  await gateway.purgeCiphertext(input.spaceId);
  await deleteSecret(holderStoreKey(input.memberUserId, input.spaceId, 'a'));
  await deleteSecret(holderStoreKey(input.memberUserId, input.spaceId, 'b'));
  const nextEpoch = (published?.recoveryKeyEpoch ?? 1) + 1;
  const pair = generateDeviceKeyPair();
  const device = await ensureDeviceIdentity(input.memberUserId);
  const meta = await gateway.fetchMeta(input.spaceId);
  try {
    const personalSeal = await personalSealForRecoveryChange({
      spaceId: input.spaceId,
      userId: input.memberUserId,
      recoveryPublicKey: pair.publicKey,
    });
    await gateway.insertRecoveryPublicKey({
      spaceId: input.spaceId,
      userId: input.memberUserId,
      publicKey: pair.publicKey,
      recoveryKeyEpoch: nextEpoch,
      personalSeal,
    });
    await sealFamilyUnderRecovery(
      {
        spaceId: input.spaceId,
        userId: input.memberUserId,
        deviceId: device.deviceId,
        privateKey: device.privateKey,
        recoveryPublicKey: pair.publicKey,
        keyEpoch: meta?.keyEpoch ?? 1,
      },
      gateway,
    );
    const contacts = (await gateway.listContacts(input.spaceId)).filter(
      (row) => row.memberId === input.memberUserId && row.status === 'accepted',
    );
    for (const contact of contacts) {
      const secret = randomKey32();
      try {
        await setSecretBytes(
          holderStoreKey(input.memberUserId, input.spaceId, contact.slot),
          secret,
        );
        await wrapHolderToDevices(
          {
            spaceId: input.spaceId,
            memberId: input.memberUserId,
            userId: contact.userId,
            secret,
            recoveryKeyEpoch: nextEpoch,
          },
          gateway,
        );
      } finally {
        wipe(secret);
      }
    }
    await rebuildPairBoxes(
      {
        spaceId: input.spaceId,
        memberUserId: input.memberUserId,
        recoveryKey: pair.privateKey,
        recoveryKeyEpoch: nextEpoch,
        paper: null,
      },
      gateway,
    );
  } finally {
    wipe(pair.privateKey);
  }
  logKeyStep('rotate_recovery_key', `${input.spaceId} ${nextEpoch}`);
}

export async function loadEligibleRecoveryContacts(
  spaceId: string,
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<{ userId: string; displayName: string }[]> {
  return gateway.listEligibleRecoveryContacts(spaceId);
}

export function approvedIdsFromEligibleContacts(
  contacts: { userId: string }[],
): Set<string> {
  return new Set(contacts.map((row) => row.userId));
}

export { generatePrintedCode };
