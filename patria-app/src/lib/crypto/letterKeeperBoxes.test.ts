// SECURITY REVIEW REQUIRED
import { openLetterContent, sealLetterContent } from './letterEnvelope';
import {
  assertPinnedRecipientLetterboxMatches,
  createLetterKeeperPairBoxes,
  openLetterKeeperWithHolders,
  unwrapKeeperHolderFromLetterbox,
  unwrapKeeperHolderFromRecipientLetterbox,
  wrapKeeperHolderToLetterbox,
  wrapKeeperHolderToRecipientLetterbox,
} from './letterKeeperBoxes';
import { combineLetterCek, splitLetterCek, wipeLetterShares } from './letterSplit';
import { generateDeviceKeyPair } from './x25519';
import { secretsEqual, wipe } from './bytes';
import { randomKey32 } from './random';

const letterId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const keeperA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('letter keeper pairwise boxes', () => {
  it('opens shareP with each pair and not with one holder', () => {
    const shareP = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const secretC = randomKey32();
    const ctx = { letterId, version: 1 };
    const boxes = createLetterKeeperPairBoxes(shareP, secretA, secretB, secretC, ctx);

    expect(
      secretsEqual(
        openLetterKeeperWithHolders(
          boxes,
          { slot: 'a', secret: secretA },
          { slot: 'b', secret: secretB },
          ctx,
        ),
        shareP,
      ),
    ).toBe(true);
    expect(
      secretsEqual(
        openLetterKeeperWithHolders(
          boxes,
          { slot: 'a', secret: secretA },
          { slot: 'c', secret: secretC },
          ctx,
        ),
        shareP,
      ),
    ).toBe(true);
    expect(
      secretsEqual(
        openLetterKeeperWithHolders(
          boxes,
          { slot: 'b', secret: secretB },
          { slot: 'c', secret: secretC },
          ctx,
        ),
        shareP,
      ),
    ).toBe(true);

    expect(() =>
      openLetterKeeperWithHolders(
        boxes,
        { slot: 'a', secret: secretA },
        { slot: 'a', secret: secretA },
        ctx,
      ),
    ).toThrow('unwrap failed');
    expect(() =>
      openLetterKeeperWithHolders(
        boxes,
        { slot: 'a', secret: secretA },
        { slot: 'b', secret: randomKey32() },
        ctx,
      ),
    ).toThrow('unwrap failed');

    wipe(shareP);
    wipe(secretA);
    wipe(secretB);
    wipe(secretC);
  });

  it('refuses a wrong version or letter id', () => {
    const shareP = randomKey32();
    const secretA = randomKey32();
    const secretB = randomKey32();
    const secretC = randomKey32();
    const ctx = { letterId, version: 2 };
    const boxes = createLetterKeeperPairBoxes(shareP, secretA, secretB, secretC, ctx);

    expect(() =>
      openLetterKeeperWithHolders(
        boxes,
        { slot: 'a', secret: secretA },
        { slot: 'b', secret: secretB },
        { letterId, version: 3 },
      ),
    ).toThrow();
    expect(() =>
      openLetterKeeperWithHolders(
        boxes,
        { slot: 'a', secret: secretA },
        { slot: 'b', secret: secretB },
        { letterId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', version: 2 },
      ),
    ).toThrow();

    wipe(shareP);
    wipe(secretA);
    wipe(secretB);
    wipe(secretC);
  });
});

describe('letter keeper security proofs', () => {
  it('two keepers alone open shareP but cannot read the letter without shareR', () => {
    const cek = randomKey32();
    const shares = splitLetterCek(cek);
    const secretA = randomKey32();
    const secretB = randomKey32();
    const secretC = randomKey32();
    const ctx = { letterId, version: 1 };
    const boxes = createLetterKeeperPairBoxes(
      shares.shareP,
      secretA,
      secretB,
      secretC,
      ctx,
    );
    const openedShareP = openLetterKeeperWithHolders(
      boxes,
      { slot: 'a', secret: secretA },
      { slot: 'b', secret: secretB },
      ctx,
    );
    expect(secretsEqual(openedShareP, shares.shareP)).toBe(true);
    expect(secretsEqual(openedShareP, cek)).toBe(false);

    const sealed = sealLetterContent(
      { body: 'for your eyes only' },
      {
        familySpaceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        letterId,
        version: 1,
        authorId: '11111111-1111-1111-1111-111111111111',
      },
    );
    expect(() =>
      openLetterContent(openedShareP, sealed.contentNonce, sealed.ciphertext, {
        familySpaceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        letterId,
        version: 1,
        authorId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toThrow();

    wipe(openedShareP);
    wipe(cek);
    wipeLetterShares(shares);
    wipe(secretA);
    wipe(secretB);
    wipe(secretC);
    wipe(sealed.cek);
  });

  it('one keeper plus recipient shareR cannot open shareP', () => {
    const cek = randomKey32();
    const shares = splitLetterCek(cek);
    const secretA = randomKey32();
    const secretB = randomKey32();
    const secretC = randomKey32();
    const ctx = { letterId, version: 1 };
    const boxes = createLetterKeeperPairBoxes(
      shares.shareP,
      secretA,
      secretB,
      secretC,
      ctx,
    );

    // Recipient has shareR and only one holder secret — no valid pair.
    expect(secretsEqual(shares.shareR, cek)).toBe(false);
    expect(() =>
      openLetterKeeperWithHolders(
        boxes,
        { slot: 'a', secret: secretA },
        { slot: 'a', secret: secretA },
        ctx,
      ),
    ).toThrow('unwrap failed');

    wipe(cek);
    wipeLetterShares(shares);
    wipe(secretA);
    wipe(secretB);
    wipe(secretC);
  });

  it('two keepers plus recipient open the letter with the same seal code', () => {
    const aad = {
      familySpaceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      letterId,
      version: 1,
      authorId: '11111111-1111-1111-1111-111111111111',
    };
    const sealed = sealLetterContent({ body: 'hello from the future' }, aad);
    const shares = splitLetterCek(sealed.cek);
    const secretA = randomKey32();
    const secretB = randomKey32();
    const secretC = randomKey32();
    const ctx = { letterId, version: 1 };
    const boxes = createLetterKeeperPairBoxes(
      shares.shareP,
      secretA,
      secretB,
      secretC,
      ctx,
    );
    const openedP = openLetterKeeperWithHolders(
      boxes,
      { slot: 'b', secret: secretB },
      { slot: 'c', secret: secretC },
      ctx,
    );
    const combined = combineLetterCek(shares.shareR, openedP);
    const content = openLetterContent(
      combined,
      sealed.contentNonce,
      sealed.ciphertext,
      aad,
    );
    expect(content.body).toBe('hello from the future');
    expect(sealed.fingerprint).toMatch(/^[0-9a-f]+$/i);

    wipe(openedP);
    wipe(combined);
    wipeLetterShares(shares);
    wipe(secretA);
    wipe(secretB);
    wipe(secretC);
    wipe(sealed.cek);
  });

  it('refuses a substituted recipient letterbox public key', () => {
    const holder = randomKey32();
    const keeper = generateDeviceKeyPair();
    const recipientAtSeal = generateDeviceKeyPair();
    const substituted = generateDeviceKeyPair();
    const aad = {
      letterId,
      version: 1,
      keeperId: keeperA,
      pinnedRecipientLetterboxPublic: recipientAtSeal.publicKey,
    };
    const wrapped = wrapKeeperHolderToLetterbox(holder, keeper.publicKey, aad);
    const opened = unwrapKeeperHolderFromLetterbox(wrapped, keeper.privateKey, aad);
    expect(secretsEqual(opened, holder)).toBe(true);

    expect(() =>
      assertPinnedRecipientLetterboxMatches(recipientAtSeal.publicKey, substituted.publicKey),
    ).toThrow('recipient key mismatch');

    expect(() =>
      wrapKeeperHolderToRecipientLetterbox(holder, substituted.publicKey, aad),
    ).toThrow('recipient key mismatch');

    // Unwrap to keeper with AAD that substitutes the pinned key also fails.
    expect(() =>
      unwrapKeeperHolderFromLetterbox(wrapped, keeper.privateKey, {
        ...aad,
        pinnedRecipientLetterboxPublic: substituted.publicKey,
      }),
    ).toThrow();

    const toRecipient = wrapKeeperHolderToRecipientLetterbox(
      holder,
      recipientAtSeal.publicKey,
      aad,
    );
    const back = unwrapKeeperHolderFromRecipientLetterbox(
      toRecipient,
      recipientAtSeal.privateKey,
      aad,
    );
    expect(secretsEqual(back, holder)).toBe(true);

    wipe(holder);
    wipe(opened);
    wipe(back);
    wipe(keeper.privateKey);
    wipe(recipientAtSeal.privateKey);
    wipe(substituted.privateKey);
  });
});
