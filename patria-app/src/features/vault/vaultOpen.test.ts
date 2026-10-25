import { openPrivateVaultDecision, sealPrivateVaultDecision } from '../../lib/crypto/vaultEnvelope';
import { randomKey32 } from '../../lib/crypto/random';
import { formatVoiceLength, openVaultEntryContent } from './vaultOpen';
import type { VaultEntryRow } from './vaultApi';

describe('vault open helpers', () => {
  it('formats a voice length and opens a private row only with the personal key', () => {
    expect(formatVoiceLength(20)).toBe('0:20');
    expect(formatVoiceLength(300)).toBe('5:00');
    const personalKey = randomKey32();
    const familyKey = randomKey32();
    const sealed = sealPrivateVaultDecision(
      personalKey,
      { title: 'Only me', body: 'Private why.', for: '' },
      {
        familySpaceId: 's1',
        entryId: 'e1',
        version: 1,
        authorId: 'u1',
      },
    );
    const row: VaultEntryRow = {
      id: 'e1',
      familySpaceId: 's1',
      authorId: 'u1',
      parentEntryId: null,
      kind: 'decision',
      version: 1,
      keyEpoch: null,
      visibility: 'private',
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
      sealed,
    };
    expect(openVaultEntryContent(row, { familyKey, personalKey: null })).toBeNull();
    expect(openVaultEntryContent(row, { familyKey, personalKey })?.title).toBe('Only me');
    expect(openPrivateVaultDecision(personalKey, sealed, {
      familySpaceId: 's1',
      entryId: 'e1',
      version: 1,
      authorId: 'u1',
    }).title).toBe('Only me');
  });
});
