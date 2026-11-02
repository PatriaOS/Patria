import { secretsEqual, wipe } from './bytes';
import { randomKey32 } from './random';
import { generateDeviceKeyPair } from './x25519';
import {
  letterFingerprint,
  openLetterAudio,
  openLetterContent,
  sealLetterAudio,
  sealLetterContent,
  unwrapLetterCekFromAuthorPersonalKey,
  unwrapLetterShareFromLetterbox,
  wrapLetterCekToAuthorPersonalKey,
  wrapLetterShareToLetterbox,
  hashLetterSealedPayload,
} from './letterEnvelope';
import { combineLetterCek, splitLetterCek } from './letterSplit';
import {
  generateP256KeyPair,
  openSharePWithReleasePrivateKey,
  sealSharePToReleasePublicKey,
} from './letterReleaseKey';

describe('letterEnvelope', () => {
  const spaceId = '22222222-2222-2222-2222-222222222222';
  const letterId = '33333333-3333-3333-3333-333333333333';
  const authorId = '44444444-4444-4444-4444-444444444444';

  it('seals content, author wrap, letterbox share, and patria ECDH share', () => {
    const personalKey = randomKey32();
    const letterbox = generateDeviceKeyPair();
    const release = generateP256KeyPair();

    const sealed = sealLetterContent(
      { body: 'For your eighteenth birthday.' },
      { familySpaceId: spaceId, letterId, version: 1, authorId },
    );
    const authorWrap = wrapLetterCekToAuthorPersonalKey(personalKey, sealed.cek, {
      familySpaceId: spaceId,
      letterId,
      version: 1,
      authorId,
    });
    const shares = splitLetterCek(sealed.cek);
    const recipientWrap = wrapLetterShareToLetterbox(shares.shareR, letterbox.publicKey, {
      letterId,
      version: 1,
    });
    const patria = sealSharePToReleasePublicKey(shares.shareP, release.publicKey, {
      letterId,
      version: 1,
    });

    const authorCek = unwrapLetterCekFromAuthorPersonalKey(
      personalKey,
      authorWrap.nonce,
      authorWrap.wrappedCek,
      { familySpaceId: spaceId, letterId, version: 1, authorId },
    );
    expect(secretsEqual(authorCek, sealed.cek)).toBe(true);

    const shareR = unwrapLetterShareFromLetterbox(recipientWrap, letterbox.privateKey, {
      letterId,
      version: 1,
    });
    expect(secretsEqual(shareR, shares.shareR)).toBe(true);

    const shareP = openSharePWithReleasePrivateKey(patria, release.secretKey, {
      letterId,
      version: 1,
    });
    const cek = combineLetterCek(shareR, shareP);
    const opened = openLetterContent(cek, sealed.contentNonce, sealed.ciphertext, {
      familySpaceId: spaceId,
      letterId,
      version: 1,
      authorId,
    });
    expect(opened.body).toBe('For your eighteenth birthday.');
    expect(sealed.fingerprint).toHaveLength(12);
    expect(letterFingerprint(hashLetterSealedPayload(sealed.ciphertext))).toBe(sealed.fingerprint);
    wipe(personalKey);
    wipe(letterbox.privateKey);
  });

  it('includes voice ciphertext in the seal fingerprint', () => {
    const plain = new Uint8Array([1, 2, 3, 4, 5]);
    const audio = sealLetterAudio(plain, {
      familySpaceId: spaceId,
      letterId,
      audioId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    const sealed = sealLetterContent(
      {
        body: 'With voice',
        audio: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          fileKey: 'aa'.repeat(32),
          nonce: 'bb'.repeat(24),
          durationSeconds: 3,
        },
      },
      { familySpaceId: spaceId, letterId, version: 1, authorId },
      audio.ciphertext,
    );
    expect(
      letterFingerprint(hashLetterSealedPayload(sealed.ciphertext, audio.ciphertext)),
    ).toBe(sealed.fingerprint);
    expect(letterFingerprint(hashLetterSealedPayload(sealed.ciphertext))).not.toBe(
      sealed.fingerprint,
    );
    const opened = openLetterAudio(audio.fileKey, audio.nonce, audio.ciphertext, {
      familySpaceId: spaceId,
      letterId,
      audioId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(Array.from(opened)).toEqual([1, 2, 3, 4, 5]);
    wipe(audio.fileKey);
    wipe(audio.nonce);
  });
});
