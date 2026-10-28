import { bytesToHex } from '@noble/hashes/utils.js';

import { sealVaultDecision } from '../../lib/crypto/vaultEnvelope';
import { randomKey32 } from '../../lib/crypto/random';
import type { VaultEntryRow } from '../vault/vaultApi';
import { HOME_VOICE_SCAN_LIMIT, peekHomeVault } from './homeVaultPeek';

function makeRow(
  id: string,
  familyKey: Uint8Array,
  title: string,
  createdAt: string,
  withAudio: boolean,
): VaultEntryRow {
  const sealed = sealVaultDecision(
    familyKey,
    {
      title,
      body: 'why',
      for: '',
      ...(withAudio
        ? {
            audio: {
              id: `audio-${id}`,
              fileKey: bytesToHex(new Uint8Array(32).fill(3)),
              nonce: bytesToHex(new Uint8Array(24).fill(4)),
              durationSeconds: 12,
            },
          }
        : {}),
    },
    {
      familySpaceId: 's1',
      entryId: id,
      version: 1,
      authorId: 'u1',
      keyEpoch: 1,
    },
  );
  return {
    id,
    familySpaceId: 's1',
    authorId: 'u1',
    parentEntryId: null,
    kind: 'decision',
    version: 1,
    keyEpoch: 1,
    visibility: 'family',
    createdAt,
    updatedAt: createdAt,
    sealed,
  };
}

describe('peekHomeVault', () => {
  const familyKey = randomKey32();

  it('returns locked for both cards', () => {
    expect(
      peekHomeVault({
        rows: [],
        members: [],
        keys: { familyKey: null, personalKey: null },
        locked: true,
      }),
    ).toEqual({ voice: { state: 'locked' }, vault: { state: 'locked' } });
  });

  it('returns empty when there are no roots', () => {
    expect(
      peekHomeVault({
        rows: [],
        members: [],
        keys: { familyKey, personalKey: null },
        locked: false,
      }),
    ).toEqual({ voice: { state: 'empty' }, vault: { state: 'empty' } });
  });

  it('picks the newest voice within the scan window', () => {
    const rows = [
      makeRow('new', familyKey, 'Plain', '2026-10-26T12:00:00Z', false),
      makeRow('voice', familyKey, 'Voice', '2026-10-25T12:00:00Z', true),
    ];
    const peek = peekHomeVault({
      rows,
      members: [{ userId: 'u1', displayName: 'Elena' }],
      keys: { familyKey, personalKey: null },
      locked: false,
    });
    expect(peek.voice.state).toBe('note');
    if (peek.voice.state === 'note') {
      expect(peek.voice.entryId).toBe('voice');
      expect(peek.voice.title).toBe('Voice');
    }
    expect(peek.vault.state).toBe('entry');
    if (peek.vault.state === 'entry') {
      expect(peek.vault.title).toBe('Plain');
    }
  });

  it('shows older when entries exist but none of the recent window have audio', () => {
    const rows = Array.from({ length: HOME_VOICE_SCAN_LIMIT }, (_, i) =>
      makeRow(`r${i}`, familyKey, `T${i}`, `2026-10-${String(26 - (i % 20)).padStart(2, '0')}T12:00:00Z`, false),
    );
    const peek = peekHomeVault({
      rows,
      members: [],
      keys: { familyKey, personalKey: null },
      locked: false,
    });
    expect(peek.voice.state).toBe('older');
  });

  it('skips the voice entry on the Vault card when another entry exists', () => {
    const rows = [
      makeRow('voice', familyKey, 'Voice decision', '2026-10-26T12:00:00Z', true),
      makeRow('plain', familyKey, 'Plain decision', '2026-10-25T12:00:00Z', false),
    ];
    const peek = peekHomeVault({
      rows,
      members: [{ userId: 'u1', displayName: 'Elena' }],
      keys: { familyKey, personalKey: null },
      locked: false,
    });
    expect(peek.voice.state).toBe('note');
    if (peek.voice.state === 'note') {
      expect(peek.voice.entryId).toBe('voice');
    }
    expect(peek.vault.state).toBe('entry');
    if (peek.vault.state === 'entry') {
      expect(peek.vault.entryId).toBe('plain');
      expect(peek.vault.title).toBe('Plain decision');
    }
  });

  it('shows the voice entry on the Vault card when it is the only root', () => {
    const rows = [makeRow('only', familyKey, 'Only voice', '2026-10-26T12:00:00Z', true)];
    const peek = peekHomeVault({
      rows,
      members: [{ userId: 'u1', displayName: 'Elena' }],
      keys: { familyKey, personalKey: null },
      locked: false,
    });
    expect(peek.voice.state).toBe('note');
    expect(peek.vault.state).toBe('entry');
    if (peek.vault.state === 'entry') {
      expect(peek.vault.entryId).toBe('only');
      expect(peek.vault.title).toBe('Only voice');
    }
  });
});
