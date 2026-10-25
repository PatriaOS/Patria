import { wipe } from '../../lib/crypto/bytes';
import { obtainPersonalKey } from '../../lib/crypto/personalKey';
import { randomUuid } from '../../lib/crypto/random';
import { openVaultAudio, sealVaultAudio } from '../../lib/crypto/vaultAudio';
import {
  sealPrivateVaultDecision,
  sealVaultDecision,
  vaultAudioRefFromSeal,
  vaultAudioRefKeys,
  type SealedVaultEntry,
  type VaultDecisionContent,
  type VaultVisibility,
} from '../../lib/crypto/vaultEnvelope';
import {
  commitVaultVisibilitySwitch,
  deleteVaultAudio,
  insertVaultEntry,
  updateVaultEntry,
  uploadVaultAudio,
  type VaultEntryRow,
} from './vaultApi';

export type PreparedVaultAudio = {
  ref: NonNullable<VaultDecisionContent['audio']>;
  ciphertext: Uint8Array;
};

export function prepareVaultAudio(input: {
  spaceId: string;
  entryId: string;
  audioId?: string;
  durationSeconds: number;
  plain: Uint8Array;
}): PreparedVaultAudio {
  const audioId = input.audioId ?? randomUuid();
  const sealed = sealVaultAudio(input.plain, {
    familySpaceId: input.spaceId,
    entryId: input.entryId,
    audioId,
  });
  return {
    ref: vaultAudioRefFromSeal(audioId, input.durationSeconds, sealed.fileKey, sealed.nonce),
    ciphertext: sealed.ciphertext,
  };
}

/** Fresh audio id (and path) for every upload attempt; leftover objects stay orphans. */
export function remintVaultAudioForUpload(input: {
  spaceId: string;
  entryId: string;
  audio: NonNullable<VaultDecisionContent['audio']>;
  ciphertext: Uint8Array;
}): PreparedVaultAudio {
  const keys = vaultAudioRefKeys(input.audio);
  let plain: Uint8Array | null = null;
  try {
    plain = openVaultAudio(keys.fileKey, keys.nonce, input.ciphertext, {
      familySpaceId: input.spaceId,
      entryId: input.entryId,
      audioId: input.audio.id,
    });
    return prepareVaultAudio({
      spaceId: input.spaceId,
      entryId: input.entryId,
      durationSeconds: input.audio.durationSeconds,
      plain,
    });
  } finally {
    if (plain) {
      wipe(plain);
    }
    wipe(keys.fileKey);
    wipe(keys.nonce);
  }
}

export function sealVaultContent(input: {
  visibility: VaultVisibility;
  familyKey: Uint8Array | null;
  personalKey: Uint8Array | null;
  content: VaultDecisionContent;
  spaceId: string;
  entryId: string;
  version: number;
  authorId: string;
  keyEpoch: number | null;
}): SealedVaultEntry {
  if (input.visibility === 'private') {
    if (!input.personalKey) {
      throw new Error('missing personal key');
    }
    return sealPrivateVaultDecision(input.personalKey, input.content, {
      familySpaceId: input.spaceId,
      entryId: input.entryId,
      version: input.version,
      authorId: input.authorId,
    });
  }
  if (!input.familyKey || input.keyEpoch == null) {
    throw new Error('missing family key');
  }
  return sealVaultDecision(input.familyKey, input.content, {
    familySpaceId: input.spaceId,
    entryId: input.entryId,
    version: input.version,
    authorId: input.authorId,
    keyEpoch: input.keyEpoch,
  });
}

export async function persistVaultDecision(input: {
  userId: string;
  spaceId: string;
  entryId: string;
  parentEntryId?: string | null;
  existing?: VaultEntryRow;
  children?: { row: VaultEntryRow; content: VaultDecisionContent }[];
  visibility: VaultVisibility;
  content: VaultDecisionContent;
  familyKey: Uint8Array | null;
  keyEpoch: number | null;
  audioCiphertext?: Uint8Array | null;
  previousAudioId?: string | null;
}): Promise<void> {
  let personalKey: Uint8Array | null = null;
  let uploadedAudioId: string | null = null;
  let content = input.content;
  try {
    if (input.visibility === 'private') {
      personalKey = await obtainPersonalKey({
        spaceId: input.spaceId,
        userId: input.userId,
      });
    }
    if (input.audioCiphertext && content.audio) {
      const prepared = remintVaultAudioForUpload({
        spaceId: input.spaceId,
        entryId: input.entryId,
        audio: content.audio,
        ciphertext: input.audioCiphertext,
      });
      content = { ...content, audio: prepared.ref };
      await uploadVaultAudio({
        spaceId: input.spaceId,
        entryId: input.entryId,
        audioId: prepared.ref.id,
        ciphertext: prepared.ciphertext,
      });
      uploadedAudioId = prepared.ref.id;
    }
    if (input.previousAudioId && input.previousAudioId !== content.audio?.id) {
      await deleteVaultAudio({
        spaceId: input.spaceId,
        entryId: input.entryId,
        audioId: input.previousAudioId,
      });
    }

    const switching =
      Boolean(input.existing) &&
      !input.parentEntryId &&
      input.existing?.visibility !== input.visibility;
    const authorId = input.existing?.authorId ?? input.userId;
    const parentVersion = input.existing ? input.existing.version + 1 : 1;
    const parentSealed = sealVaultContent({
      visibility: input.visibility,
      familyKey: input.familyKey,
      personalKey,
      content,
      spaceId: input.spaceId,
      entryId: input.entryId,
      version: parentVersion,
      authorId,
      keyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
    });

    // Visibility changes always go through the switch RPC (including zero
    // follow-ups) so patria.vault_switch is set and children stay in sync.
    if (switching && input.existing) {
      const children = (input.children ?? []).map((child) => ({
        id: child.row.id,
        expectedVersion: child.row.version,
        keyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
        sealed: sealVaultContent({
          visibility: input.visibility,
          familyKey: input.familyKey,
          personalKey,
          content: child.content,
          spaceId: input.spaceId,
          entryId: child.row.id,
          version: child.row.version + 1,
          authorId: child.row.authorId,
          keyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
        }),
      }));
      await commitVaultVisibilitySwitch({
        parentId: input.existing.id,
        visibility: input.visibility,
        parentExpectedVersion: input.existing.version,
        parentKeyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
        parentSealed,
        children,
      });
      return;
    }

    if (input.existing) {
      await updateVaultEntry({
        id: input.existing.id,
        expectedVersion: input.existing.version,
        keyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
        visibility: input.visibility,
        sealed: parentSealed,
      });
      return;
    }

    await insertVaultEntry({
      id: input.entryId,
      familySpaceId: input.spaceId,
      authorId: input.userId,
      parentEntryId: input.parentEntryId ?? null,
      keyEpoch: input.visibility === 'family' ? input.keyEpoch : null,
      visibility: input.visibility,
      sealed: parentSealed,
    });
  } catch (error) {
    if (uploadedAudioId && uploadedAudioId !== input.previousAudioId) {
      try {
        await deleteVaultAudio({
          spaceId: input.spaceId,
          entryId: input.entryId,
          audioId: uploadedAudioId,
        });
      } catch {
        // cleanup_orphaned_vault_objects removes leftovers after an hour.
      }
    }
    throw error;
  } finally {
    if (personalKey) {
      wipe(personalKey);
    }
  }
}
