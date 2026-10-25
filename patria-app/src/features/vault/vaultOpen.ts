import {
  openPrivateVaultDecision,
  openVaultDecision,
  type VaultDecisionContent,
} from '../../lib/crypto/vaultEnvelope';
import type { VaultEntryRow } from './vaultApi';

export function openVaultEntryContent(
  row: VaultEntryRow,
  keys: { familyKey: Uint8Array | null; personalKey: Uint8Array | null },
): VaultDecisionContent | null {
  try {
    if (row.visibility === 'private') {
      if (!keys.personalKey) {
        return null;
      }
      return openPrivateVaultDecision(keys.personalKey, row.sealed, {
        familySpaceId: row.familySpaceId,
        entryId: row.id,
        version: row.version,
        authorId: row.authorId,
      });
    }
    if (!keys.familyKey || row.keyEpoch == null) {
      return null;
    }
    return openVaultDecision(keys.familyKey, row.sealed, {
      familySpaceId: row.familySpaceId,
      entryId: row.id,
      version: row.version,
      authorId: row.authorId,
      keyEpoch: row.keyEpoch,
    });
  } catch {
    return null;
  }
}

export function formatVoiceLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
