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
  type FullRecoveryBoxes,
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
  | 'almost_done'
  | 'setup'
  | 'needs_attention'
  | 'contact';

export type RecoverySnapshot = {
  contacts: RecoveryContactRow[];
  ownContacts: RecoveryContactRow[];
  accepted: number;
  pending: RecoveryContactRow[];
  /** Server has the ab pair box for this recovery epoch. */
  hasAb: boolean;
  hasPaper: boolean;
  hasRecoveryPublic: boolean;
  recoveryKeyEpoch: number;
  keyEpoch: number;
  status: RecoveryHomeStatus;
};

function holderStoreKey(userId: string, spaceId: string, slot: RecoverySlot): string {
  return `patria.u.${userId}.holder.${spaceId}.${slot}`;
}

/** Kept until ab is on the server so a later second-contact accept can build ab. */
export function recoveryPrivateStoreKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.recovery.private.${spaceId}`;
}

/** Wipe the temporary recovery private (after ab, repair, or sign-out). Never log it. */
export async function clearRecoveryPrivateSecret(
  userId: string,
  spaceId: string,
): Promise<void> {
  await deleteSecret(recoveryPrivateStoreKey(userId, spaceId));
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
    if (!snapshot.hasAb) {
      return 'needs_attention';
    }
    if (!snapshot.hasPaper) {
      return 'almost_done';
    }
    return 'setup';
  }
  // One contact left after ab/paper existed = contact removed; needs a replacement
  // (D27). First accept mid-setup (public uploaded, no ab yet) stays one_of_two.
  if (snapshot.accepted === 1) {
    if (snapshot.hasAb || snapshot.hasPaper) {
      return 'needs_attention';
    }
    return 'one_of_two';
  }
  // Orphan public key with no accepted contacts: setup started then contacts gone.
  if (snapshot.hasRecoveryPublic && snapshot.accepted === 0) {
    return 'needs_attention';
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
    hasAb: pairIds.includes('ab'),
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
  let recoveryPrivate = pair?.privateKey ?? null;
  const privateStore = recoveryPrivateStoreKey(input.memberUserId, input.spaceId);
  try {
    if (pair && recoveryPrivate) {
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
      await setSecretBytes(privateStore, recoveryPrivate);
    } else if (!recoveryPrivate) {
      recoveryPrivate = await getSecretBytes(privateStore);
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
    if (contacts.length >= 2) {
      const existing = await gateway.listPairIds(
        input.spaceId,
        input.memberUserId,
        recoveryKeyEpoch,
      );
      if (!existing.includes('ab')) {
        if (!recoveryPrivate) {
          throw new Error('recovery-ab-needs-repair');
        }
        const boxes = await rebuildPairBoxes(
          {
            spaceId: input.spaceId,
            memberUserId: input.memberUserId,
            recoveryKey: recoveryPrivate,
            recoveryKeyEpoch,
            paper: null,
          },
          gateway,
        );
        if (!boxes) {
          throw new Error('recovery-ab-failed');
        }
        const after = await gateway.listPairIds(
          input.spaceId,
          input.memberUserId,
          recoveryKeyEpoch,
        );
        if (!after.includes('ab')) {
          throw new Error('recovery-ab-failed');
        }
        await clearRecoveryPrivateSecret(input.memberUserId, input.spaceId);
      } else {
        await clearRecoveryPrivateSecret(input.memberUserId, input.spaceId);
      }
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
): Promise<FullRecoveryBoxes | null> {
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
): FullRecoveryBoxes {
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
    const after = await gateway.listPairIds(
      input.spaceId,
      input.memberUserId,
      published.recoveryKeyEpoch,
    );
    if (!after.includes('ap') || !after.includes('bp')) {
      throw new Error('printed boxes missing');
    }
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

type HolderUpload = {
  contactUserId: string;
  deviceId: string;
  wrappedSecret: Uint8Array;
};

async function buildHolderUploads(
  input: {
    spaceId: string;
    memberId: string;
    contacts: RecoveryContactRow[];
    recoveryKeyEpoch: number;
  },
  gateway: RecoveryAccessGateway,
): Promise<{ uploads: HolderUpload[]; secretA: Uint8Array; secretB: Uint8Array }> {
  const secretA = randomKey32();
  const secretB = randomKey32();
  const bySlot: Record<RecoverySlot, Uint8Array> = { a: secretA, b: secretB };
  const uploads: HolderUpload[] = [];
  try {
    for (const contact of input.contacts) {
      const secret = bySlot[contact.slot];
      const devices = await gateway.listRecoveryContactPublicKeys(input.spaceId, contact.userId);
      for (const device of devices) {
        const publicKey = requireX25519PublicKey(device.publicKey);
        const wrapped = wrapKeyToDevice(
          secret,
          publicKey,
          wrapAad({
            spaceId: input.spaceId,
            epoch: input.recoveryKeyEpoch,
            userId: contact.userId,
            deviceId: device.deviceId,
          }),
        );
        uploads.push({
          contactUserId: contact.userId,
          deviceId: device.deviceId,
          wrappedSecret: wrapped,
        });
      }
    }
    if (uploads.length === 0) {
      throw new Error('recovery-contacts-need-devices');
    }
    // Local SecureStore is updated only after commit succeeds (repairRecoverySetup).
    return { uploads, secretA, secretB };
  } catch (error) {
    wipe(secretA);
    wipe(secretB);
    throw error;
  }
}

/**
 * Fresh recovery epoch: upload new holders+ab first, then atomic RPC switches the
 * public key and drops the old epoch. Refuses while a recovery request is open.
 * Requires this phone to hold the family key.
 */
export async function repairRecoverySetup(
  input: {
    spaceId: string;
    memberUserId: string;
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  if (await gateway.hasOpenRecoveryRequest(input.spaceId, input.memberUserId)) {
    throw new Error('recovery request open');
  }
  const device = await ensureDeviceIdentity(input.memberUserId);
  const familyKey = await obtainFamilyKey({
    userId: input.memberUserId,
    spaceId: input.spaceId,
    deviceId: device.deviceId,
    privateKey: device.privateKey,
    fetchOwnWrap: supabaseDeviceAccessGateway.fetchOwnWrap,
  });
  if (!familyKey) {
    throw new Error('missing family key');
  }
  const published = await gateway.fetchOwnRecoveryPublic(input.spaceId, input.memberUserId);
  const meta = await gateway.fetchMeta(input.spaceId);
  const oldEpoch = published?.recoveryKeyEpoch ?? 1;
  const newEpoch = oldEpoch + 1;
  const pair = generateDeviceKeyPair();
  const contacts = (await gateway.listContacts(input.spaceId)).filter(
    (row) => row.memberId === input.memberUserId && row.status === 'accepted',
  );
  if (contacts.length < 2) {
    wipe(familyKey);
    wipe(pair.privateKey);
    throw new Error('need two accepted contacts');
  }
  let secretA: Uint8Array | null = null;
  let secretB: Uint8Array | null = null;
  try {
    const personalSeal = await personalSealForRecoveryChange({
      spaceId: input.spaceId,
      userId: input.memberUserId,
      recoveryPublicKey: pair.publicKey,
    });
    const built = await buildHolderUploads(
      {
        spaceId: input.spaceId,
        memberId: input.memberUserId,
        contacts,
        recoveryKeyEpoch: newEpoch,
      },
      gateway,
    );
    secretA = built.secretA;
    secretB = built.secretB;
    const ephemeralPaper = randomKey32();
    let boxes: FullRecoveryBoxes;
    try {
      boxes = createRecoveryBoxes(pair.privateKey, secretA, secretB, ephemeralPaper, {
        familySpaceId: input.spaceId,
        userId: input.memberUserId,
        recoveryKeyEpoch: newEpoch,
      });
    } finally {
      wipe(ephemeralPaper);
    }
    // ab only until the member writes a real printed code (ap/bp).
    const familyKeyEpoch = meta?.keyEpoch ?? 1;
    const wrappedFamily = wrapFamilyKeyToRecoveryPublic(familyKey, pair.publicKey, {
      familySpaceId: input.spaceId,
      keyEpoch: familyKeyEpoch,
      userId: input.memberUserId,
    });
    await gateway.commitRecoveryRepair({
      spaceId: input.spaceId,
      oldEpoch,
      newEpoch,
      publicKey: pair.publicKey,
      familyKeyEpoch,
      wrappedFamilyKey: wrappedFamily,
      personalSeal,
      contactUserIds: built.uploads.map((row) => row.contactUserId),
      contactDeviceIds: built.uploads.map((row) => row.deviceId),
      wrappedHolderSecrets: built.uploads.map((row) => row.wrappedSecret),
      abBox: boxes.boxAb,
    });
    await clearRecoveryPrivateSecret(input.memberUserId, input.spaceId);
    await setSecretBytes(holderStoreKey(input.memberUserId, input.spaceId, 'a'), secretA);
    await setSecretBytes(holderStoreKey(input.memberUserId, input.spaceId, 'b'), secretB);
    logKeyStep('repair_recovery_setup', `${input.spaceId} ${newEpoch}`);
  } finally {
    wipe(familyKey);
    wipe(pair.privateKey);
    if (secretA) {
      wipe(secretA);
    }
    if (secretB) {
      wipe(secretB);
    }
  }
}

/** Paper lost / redo: same atomic repair path (new epoch, then printed code again). */
export async function rotateRecoveryKey(
  input: {
    spaceId: string;
    memberUserId: string;
  },
  gateway: RecoveryAccessGateway = supabaseRecoveryAccessGateway,
): Promise<void> {
  await repairRecoverySetup(input, gateway);
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
