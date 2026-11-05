import { randomKey32 } from './random';
import { secretsEqual } from './bytes';
import {
  generateP256KeyPair,
  isCompressedLetterReleasePublicKeyHex,
  openSharePWithDerivedSecret,
  openSharePWithReleasePrivateKey,
  releasePublicKeyToHex,
  sealSharePToReleasePublicKey,
  ecdhSharedSecretRaw,
} from './letterReleaseKey';
import { p256 } from '@noble/curves/nist.js';

describe('letterReleaseKey', () => {
  const aad = { letterId: '11111111-1111-1111-1111-111111111111', version: 1 };

  it('accepts only 66-char compressed SEC1 hex (02/03 + x) for the app public key', () => {
    const release = generateP256KeyPair();
    const hex = releasePublicKeyToHex(release.publicKey);
    expect(isCompressedLetterReleasePublicKeyHex(hex)).toBe(true);
    expect(isCompressedLetterReleasePublicKeyHex(hex.toUpperCase())).toBe(true);
    expect(isCompressedLetterReleasePublicKeyHex('04' + hex.slice(2))).toBe(false);
    expect(isCompressedLetterReleasePublicKeyHex(hex.slice(0, 64))).toBe(false);
    expect(isCompressedLetterReleasePublicKeyHex(undefined)).toBe(false);
  });

  it('seals shareP to a release public key and opens with the matching private key', () => {
    const release = generateP256KeyPair();
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(shareP, release.publicKey, aad);
    const opened = openSharePWithReleasePrivateKey(sealed, release.secretKey, aad);
    expect(secretsEqual(opened, shareP)).toBe(true);
  });

  it('opens with a KMS-style raw shared secret (x-coordinate)', () => {
    const release = generateP256KeyPair();
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(shareP, release.publicKey, aad);
    const shared = p256.getSharedSecret(release.secretKey, sealed.ephemeralPublicKey);
    const raw = ecdhSharedSecretRaw(shared);
    const opened = openSharePWithDerivedSecret(sealed, raw, aad);
    expect(secretsEqual(opened, shareP)).toBe(true);
  });

  it('fails when the letter version in AAD does not match', () => {
    const release = generateP256KeyPair();
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(shareP, release.publicKey, aad);
    expect(() =>
      openSharePWithReleasePrivateKey(sealed, release.secretKey, { ...aad, version: 2 }),
    ).toThrow('unwrap failed');
  });
});
