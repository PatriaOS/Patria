import { secretsEqual, wipe } from './bytes';
import {
  mintLetterboxForPersonalKey,
  unwrapLetterboxPrivateKey,
  wrapLetterboxPrivateKey,
} from './letterbox';
import { randomKey32 } from './random';
import { x25519PublicKey } from './x25519';

describe('letterbox', () => {
  const aad = {
    familySpaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
  };

  it('wraps and unwraps the private key with the personal key', () => {
    const personal = randomKey32();
    const minted = mintLetterboxForPersonalKey(personal, aad);
    try {
      expect(minted.publicKey).toEqual(x25519PublicKey(minted.privateKey));
      const opened = unwrapLetterboxPrivateKey(
        personal,
        minted.nonce,
        minted.wrappedPrivate,
        aad,
      );
      try {
        expect(secretsEqual(opened, minted.privateKey)).toBe(true);
      } finally {
        wipe(opened);
      }
    } finally {
      wipe(personal);
      wipe(minted.privateKey);
      wipe(minted.publicKey);
    }
  });

  it('refuses a different family or user in the AAD', () => {
    const personal = randomKey32();
    const privateKey = randomKey32();
    try {
      const wrapped = wrapLetterboxPrivateKey(personal, privateKey, aad);
      expect(() =>
        unwrapLetterboxPrivateKey(personal, wrapped.nonce, wrapped.wrappedPrivate, {
          ...aad,
          userId: '33333333-3333-3333-3333-333333333333',
        }),
      ).toThrow();
    } finally {
      wipe(personal);
      wipe(privateKey);
    }
  });
});
