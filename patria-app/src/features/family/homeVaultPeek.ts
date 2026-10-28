// SECURITY REVIEW REQUIRED
import type { VaultAudioRef, VaultDecisionContent } from '../../lib/crypto/vaultEnvelope';
import type { VaultEntryRow } from '../vault/vaultApi';
import { openVaultEntryContent } from '../vault/vaultOpen';
import { formatVaultDate, vaultAuthorLabel } from '../vault/vaultAuthor';

export const HOME_VOICE_SCAN_LIMIT = 10;

export type HomeVoicePeek =
  | { state: 'locked' }
  | { state: 'empty' }
  | { state: 'older' }
  | {
      state: 'note';
      entryId: string;
      title: string;
      authorLabel: string;
      whenLabel: string;
      durationSeconds: number;
      audio: VaultAudioRef;
    };

export type HomeVaultHighlight =
  | { state: 'locked' }
  | { state: 'empty' }
  | {
      state: 'entry';
      entryId: string;
      title: string;
      whenLabel: string;
      visibility: VaultEntryRow['visibility'];
    };

export type HomeVaultPeekResult = {
  voice: HomeVoicePeek;
  vault: HomeVaultHighlight;
};

function rootEntries(rows: VaultEntryRow[]): VaultEntryRow[] {
  return rows.filter((row) => row.parentEntryId == null);
}

function openContent(
  row: VaultEntryRow,
  keys: { familyKey: Uint8Array | null; personalKey: Uint8Array | null },
): VaultDecisionContent | null {
  return openVaultEntryContent(row, keys);
}

function vaultFromRow(
  row: VaultEntryRow,
  content: VaultDecisionContent,
): Extract<HomeVaultHighlight, { state: 'entry' }> {
  return {
    state: 'entry',
    entryId: row.id,
    title: content.title,
    whenLabel: formatVaultDate(row.createdAt),
    visibility: row.visibility,
  };
}

/**
 * Picks Home voice + vault card content from sealed rows. Decrypts only the
 * entries needed (at most 10 recent for voice, plus one for the vault highlight).
 * Callers must keep the result in memory only — never persist titles or audio.
 *
 * When the voice card shows an entry, the Vault card prefers the next most
 * recent different entry so the two cards are not the same decision. If there
 * is no other entry, the Vault card still shows that one.
 */
export function peekHomeVault(input: {
  rows: VaultEntryRow[];
  members: { userId: string; displayName: string }[];
  keys: { familyKey: Uint8Array | null; personalKey: Uint8Array | null };
  locked: boolean;
}): HomeVaultPeekResult {
  if (input.locked) {
    return { voice: { state: 'locked' }, vault: { state: 'locked' } };
  }

  const roots = rootEntries(input.rows);
  if (roots.length === 0) {
    return { voice: { state: 'empty' }, vault: { state: 'empty' } };
  }

  let voice: HomeVoicePeek = { state: 'older' };
  let voiceEntryId: string | null = null;
  for (const row of roots.slice(0, HOME_VOICE_SCAN_LIMIT)) {
    const content = openContent(row, input.keys);
    if (content?.audio) {
      voiceEntryId = row.id;
      voice = {
        state: 'note',
        entryId: row.id,
        title: content.title,
        authorLabel: vaultAuthorLabel(row.authorId, input.members),
        whenLabel: formatVaultDate(row.createdAt),
        durationSeconds: content.audio.durationSeconds,
        audio: content.audio,
      };
      break;
    }
  }

  let vault: HomeVaultHighlight = { state: 'empty' };
  for (const row of roots) {
    if (voiceEntryId != null && row.id === voiceEntryId) {
      continue;
    }
    const content = openContent(row, input.keys);
    if (content) {
      vault = vaultFromRow(row, content);
      break;
    }
  }
  if (vault.state === 'empty') {
    // No other entry, or no voice skip — show the newest decryptable root.
    for (const row of roots) {
      const content = openContent(row, input.keys);
      if (content) {
        vault = vaultFromRow(row, content);
        break;
      }
    }
  }

  return { voice, vault };
}
