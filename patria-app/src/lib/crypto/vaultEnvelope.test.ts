// SECURITY REVIEW REQUIRED
import { secretsEqual, wipe } from './bytes';
import { randomKey32, randomNonce24 } from './random';
import {
  openPrivateVaultDecision,
  openVaultDecision,
  padVaultPlaintext,
  rewrapVaultCek,
  sealPrivateVaultDecision,
  sealVaultDecision,
  serializeVaultDecision,
  unpadVaultPlaintext,
  VAULT_PAD_BLOCK,
  vaultAudioRefFromSeal,
} from './vaultEnvelope';

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENTRY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AUTHOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('vault envelope', () => {
  it('pads JSON to the next 1 KB and strips padding after decrypt', () => {
    const json = serializeVaultDecision({ title: 'Move', body: 'For the kids.', for: 'Lily' });
    const padded = padVaultPlaintext(json);
    expect(padded.length).toBe(VAULT_PAD_BLOCK);
    expect(unpadVaultPlaintext(padded)).toEqual(json);
  });

  it('round-trips a decision under the family key', () => {
    const familyKey = randomKey32();
    const content = { title: 'We moved', body: 'So the kids could be near Abuela.', for: 'Lily' };
    const sealed = sealVaultDecision(familyKey, content, {
      familySpaceId: SPACE,
      entryId: ENTRY,
      version: 1,
      authorId: AUTHOR,
      keyEpoch: 1,
    });
    expect(sealed.wrappedCek.length).toBe(48);
    expect(sealed.contentNonce.length).toBe(24);
    expect(sealed.cekNonce.length).toBe(24);
    expect(sealed.ciphertext.length % VAULT_PAD_BLOCK).toBe(16);
    const opened = openVaultDecision(familyKey, sealed, {
      familySpaceId: SPACE,
      entryId: ENTRY,
      version: 1,
      authorId: AUTHOR,
      keyEpoch: 1,
    });
    expect(opened).toEqual(content);
    wipe(familyKey);
  });

  it('refuses a different family key or epoch', () => {
    const familyKey = randomKey32();
    const other = randomKey32();
    const sealed = sealVaultDecision(
      familyKey,
      { title: 'A', body: 'B', for: '' },
      {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 1,
      },
    );
    expect(() =>
      openVaultDecision(other, sealed, {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 1,
      }),
    ).toThrow('unwrap failed');
    expect(() =>
      openVaultDecision(familyKey, sealed, {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 2,
      }),
    ).toThrow('unwrap failed');
    wipe(familyKey);
    wipe(other);
  });

  it('rewraps a CEK for the next epoch', () => {
    const oldKey = randomKey32();
    const newKey = randomKey32();
    const sealed = sealVaultDecision(
      oldKey,
      { title: 'A', body: 'B', for: '' },
      {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 1,
      },
    );
    const next = rewrapVaultCek(oldKey, newKey, {
      wrappedCek: sealed.wrappedCek,
      cekNonce: sealed.cekNonce,
      familySpaceId: SPACE,
      entryId: ENTRY,
      version: 1,
      oldEpoch: 1,
      nextEpoch: 2,
    });
    expect(secretsEqual(next.wrappedCek, sealed.wrappedCek)).toBe(false);
    const opened = openVaultDecision(
      newKey,
      { ...sealed, cekNonce: next.nonce, wrappedCek: next.wrappedCek },
      {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 2,
      },
    );
    expect(opened.title).toBe('A');
    wipe(oldKey);
    wipe(newKey);
  });

  it('round-trips a private decision and keeps audio metadata inside the CEK', () => {
    const personalKey = randomKey32();
    const audio = vaultAudioRefFromSeal(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      20,
      randomKey32(),
      randomNonce24(),
    );
    const content = {
      title: 'Only me',
      body: 'Kept to myself.',
      for: '',
      audio,
    };
    const sealed = sealPrivateVaultDecision(personalKey, content, {
      familySpaceId: SPACE,
      entryId: ENTRY,
      version: 1,
      authorId: AUTHOR,
    });
    const opened = openPrivateVaultDecision(personalKey, sealed, {
      familySpaceId: SPACE,
      entryId: ENTRY,
      version: 1,
      authorId: AUTHOR,
    });
    expect(opened).toEqual(content);
    const familyKey = randomKey32();
    expect(() =>
      openVaultDecision(familyKey, sealed, {
        familySpaceId: SPACE,
        entryId: ENTRY,
        version: 1,
        authorId: AUTHOR,
        keyEpoch: 1,
      }),
    ).toThrow('unwrap failed');
    wipe(personalKey);
    wipe(familyKey);
  });
});
