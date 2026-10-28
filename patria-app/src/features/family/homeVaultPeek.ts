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

/**
 * Picks Home voice + vault card content from sealed rows. Decrypts only the
 * entries needed (at most 10 recent for voice, plus one for the vault highlight).
 * Callers must keep the result in memory only — never persist titles or audio.
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

  const latest = roots[0];
  const latestContent = openContent(latest, input.keys);
  const vault: HomeVaultHighlight = latestContent
    ? {
        state: 'entry',
        entryId: latest.id,
        title: latestContent.title,
        whenLabel: formatVaultDate(latest.createdAt),
        visibility: latest.visibility,
      }
    : { state: 'empty' };

  const window = roots.slice(0, HOME_VOICE_SCAN_LIMIT);
  for (const row of window) {
    const content = openContent(row, input.keys);
    if (content?.audio) {
      return {
        voice: {
          state: 'note',
          entryId: row.id,
          title: content.title,
          authorLabel: vaultAuthorLabel(row.authorId, input.members),
          whenLabel: formatVaultDate(row.createdAt),
          durationSeconds: content.audio.durationSeconds,
          audio: content.audio,
        },
        vault,
      };
    }
  }

  // Entries exist but none of the recent window had audio — point to the Vault.
  return { voice: { state: 'older' }, vault };
}
