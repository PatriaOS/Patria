import { obtainPersonalKey } from '../../lib/crypto/personalKey';
import { randomKey32 } from '../../lib/crypto/random';
import {
  commitVaultVisibilitySwitch,
  deleteVaultAudio,
  insertVaultEntry,
  updateVaultEntry,
  uploadVaultAudio,
} from './vaultApi';
import { persistVaultDecision, prepareVaultAudio } from './vaultSave';

jest.mock('./vaultApi', () => ({
  uploadVaultAudio: jest.fn(async () => undefined),
  deleteVaultAudio: jest.fn(async () => undefined),
  insertVaultEntry: jest.fn(async () => undefined),
  updateVaultEntry: jest.fn(async () => undefined),
  commitVaultVisibilitySwitch: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/personalKey', () => ({
  obtainPersonalKey: jest.fn(),
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENTRY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('persistVaultDecision', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('remints a fresh audio id on upload, and removes that upload if the entry insert is refused', async () => {
    const familyKey = randomKey32();
    const prepared = prepareVaultAudio({
      spaceId: SPACE,
      entryId: ENTRY,
      durationSeconds: 20,
      plain: new Uint8Array([1, 2, 3, 4]),
    });
    (insertVaultEntry as jest.Mock).mockRejectedValueOnce(
      new Error('insert: new row violates row-level security policy'),
    );
    await expect(
      persistVaultDecision({
        userId: USER,
        spaceId: SPACE,
        entryId: ENTRY,
        visibility: 'family',
        content: {
          title: 'We moved',
          body: 'So they could be near Abuela.',
          for: 'Lily',
          audio: prepared.ref,
        },
        familyKey,
        keyEpoch: 1,
        audioCiphertext: prepared.ciphertext,
      }),
    ).rejects.toThrow(/row-level security/);
    expect(uploadVaultAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE,
        entryId: ENTRY,
        ciphertext: expect.any(Uint8Array),
      }),
    );
    const uploaded = (uploadVaultAudio as jest.Mock).mock.calls[0]?.[0] as {
      audioId: string;
    };
    expect(uploaded.audioId).not.toBe(prepared.ref.id);
    expect(deleteVaultAudio).toHaveBeenCalledWith({
      spaceId: SPACE,
      entryId: ENTRY,
      audioId: uploaded.audioId,
    });
    expect(commitVaultVisibilitySwitch).not.toHaveBeenCalled();
    expect(updateVaultEntry).not.toHaveBeenCalled();
    expect(obtainPersonalKey).not.toHaveBeenCalled();
  });

  it('switches a parent with no follow-ups through the visibility switch RPC', async () => {
    const familyKey = randomKey32();
    const existing = {
      id: ENTRY,
      familySpaceId: SPACE,
      authorId: USER,
      parentEntryId: null,
      kind: 'decision' as const,
      version: 1,
      keyEpoch: null,
      visibility: 'private' as const,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
      sealed: {
        contentNonce: new Uint8Array(24),
        ciphertext: new Uint8Array(32),
        cekNonce: new Uint8Array(24),
        wrappedCek: new Uint8Array(48),
      },
    };
    await persistVaultDecision({
      userId: USER,
      spaceId: SPACE,
      entryId: ENTRY,
      existing,
      visibility: 'family',
      content: { title: 'Kept to myself', body: 'A note only I should read.', for: '' },
      familyKey,
      keyEpoch: 1,
    });
    expect(commitVaultVisibilitySwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: ENTRY,
        visibility: 'family',
        parentExpectedVersion: 1,
        parentKeyEpoch: 1,
        children: [],
      }),
    );
    expect(updateVaultEntry).not.toHaveBeenCalled();
    expect(insertVaultEntry).not.toHaveBeenCalled();
  });
});
