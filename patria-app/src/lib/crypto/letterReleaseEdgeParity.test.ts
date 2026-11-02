import { p256 } from '@noble/curves/nist.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  ephemeralPublicKeyToSpki,
  openSharePLocal,
  openShareWithKmsSecret,
} from '../../../supabase/functions/letter-release/release';
import { secretsEqual } from './bytes';
import {
  ecdhSharedSecretRaw,
  generateP256KeyPair,
  openSharePWithReleasePrivateKey,
  sealSharePToReleasePublicKey,
} from './letterReleaseKey';
import { randomKey32 } from './random';

// The Edge Function re-implements the open step with the same noble primitives.
// Keep it byte-for-byte compatible with what the phone seals.
describe('letter-release Edge open parity', () => {
  const aad = { letterId: '22222222-2222-2222-2222-222222222222', version: 3 };

  it('opens what the phone sealed, with the local fake key', () => {
    const release = generateP256KeyPair();
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(shareP, release.publicKey, aad);
    const opened = openSharePLocal({
      privateKey: release.secretKey,
      ephemeralPublic: sealed.ephemeralPublicKey,
      sealedShare: sealed.sealedShare,
      letterId: aad.letterId,
      version: aad.version,
    });
    expect(secretsEqual(opened, shareP)).toBe(true);
    expect(
      secretsEqual(openSharePWithReleasePrivateKey(sealed, release.secretKey, aad), opened),
    ).toBe(true);
  });

  it('opens with a KMS-style raw x-coordinate secret', () => {
    const release = generateP256KeyPair();
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(shareP, release.publicKey, aad);
    const raw = ecdhSharedSecretRaw(
      p256.getSharedSecret(release.secretKey, sealed.ephemeralPublicKey),
    );
    expect(raw).toHaveLength(32);
    const opened = openShareWithKmsSecret({
      sharedSecret: raw,
      sealedShare: sealed.sealedShare,
      letterId: aad.letterId,
      version: aad.version,
    });
    expect(secretsEqual(opened, shareP)).toBe(true);
  });

  it('refuses a different letter id or version', () => {
    const release = generateP256KeyPair();
    const sealed = sealSharePToReleasePublicKey(randomKey32(), release.publicKey, aad);
    const base = {
      privateKey: release.secretKey,
      ephemeralPublic: sealed.ephemeralPublicKey,
      sealedShare: sealed.sealedShare,
    };
    expect(() =>
      openSharePLocal({ ...base, letterId: aad.letterId, version: aad.version + 1 }),
    ).toThrow('unwrap failed');
    expect(() =>
      openSharePLocal({
        ...base,
        letterId: '33333333-3333-3333-3333-333333333333',
        version: aad.version,
      }),
    ).toThrow('unwrap failed');
  });

  it('builds the DER public key KMS expects (26 byte header + 65 byte point)', () => {
    const release = generateP256KeyPair();
    const spki = ephemeralPublicKeyToSpki(release.publicKey);
    expect(spki).toHaveLength(26 + 65);
    expect(bytesToHex(spki.subarray(0, 26))).toBe(
      '3059301306072a8648ce3d020106082a8648ce3d030107034200',
    );
    expect(spki[26]).toBe(0x04);
  });
});
