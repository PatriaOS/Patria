// SECURITY REVIEW REQUIRED
import { concatBytes, encodeUtf8Prefixed, requireLength, secretsEqual, u32be, utf8ToBytes, wipe } from './bytes';
import { hkdfSha256 } from './hkdf';
import { openXChaCha20Poly1305, sealXChaCha20Poly1305 } from './aead';
import { KEY_BYTES } from './random';
import { unwrapSecretWithAad, wrapSecretWithAad } from './wrap';

/** Keeper slots for the optional 2-of-3 shareP path (LEG02 B2). */
export type LetterKeeperSlot = 'a' | 'b' | 'c';

export type LetterKeeperPairId = 'ab' | 'ac' | 'bc';

export type LetterKeeperPairBoxes = {
  boxAb: Uint8Array;
  boxAc: Uint8Array;
  boxBc: Uint8Array;
};

export type LetterKeeperHolderAad = {
  letterId: string;
  version: number;
  keeperId: string;
  /** Recipient letterbox public key pinned at seal (authenticated by AEAD). */
  pinnedRecipientLetterboxPublic: Uint8Array;
};

export type LetterKeeperPairContext = {
  letterId: string;
  version: number;
};

const HOLDER_CONTEXT = utf8ToBytes('patria/letter-keeper-holder/v1');
const HOLDER_PURPOSE = utf8ToBytes('keeper-holder');
const HOLDER_TO_RECIPIENT_CONTEXT = utf8ToBytes('patria/letter-keeper-holder-to-recipient/v1');
const HOLDER_TO_RECIPIENT_PURPOSE = utf8ToBytes('keeper-to-recipient');
const PAIR_INFO = utf8ToBytes('patria/letter-keeper-pair/v1');

const SLOT_ORDER: LetterKeeperSlot[] = ['a', 'b', 'c'];

export function encodeLetterKeeperHolderAad(aad: LetterKeeperHolderAad): Uint8Array {
  requireLength(aad.pinnedRecipientLetterboxPublic, KEY_BYTES);
  return concatBytes(
    HOLDER_CONTEXT,
    encodeUtf8Prefixed(aad.letterId),
    u32be(aad.version),
    encodeUtf8Prefixed(aad.keeperId),
    HOLDER_PURPOSE,
    aad.pinnedRecipientLetterboxPublic,
  );
}

export function encodeLetterKeeperHolderToRecipientAad(aad: LetterKeeperHolderAad): Uint8Array {
  requireLength(aad.pinnedRecipientLetterboxPublic, KEY_BYTES);
  return concatBytes(
    HOLDER_TO_RECIPIENT_CONTEXT,
    encodeUtf8Prefixed(aad.letterId),
    u32be(aad.version),
    encodeUtf8Prefixed(aad.keeperId),
    HOLDER_TO_RECIPIENT_PURPOSE,
    aad.pinnedRecipientLetterboxPublic,
  );
}

function pairAad(ctx: LetterKeeperPairContext, pair: LetterKeeperPairId): Uint8Array {
  return concatBytes(
    PAIR_INFO,
    encodeUtf8Prefixed(ctx.letterId),
    u32be(ctx.version),
    utf8ToBytes(pair),
  );
}

function pairInfo(ctx: LetterKeeperPairContext): Uint8Array {
  return concatBytes(PAIR_INFO, encodeUtf8Prefixed(ctx.letterId), u32be(ctx.version));
}

/** Fixed slot order for HKDF IKM (a before b before c), not secret byte order. */
function orderedSecretsForSlots(
  slotX: LetterKeeperSlot,
  secretX: Uint8Array,
  slotY: LetterKeeperSlot,
  secretY: Uint8Array,
): [Uint8Array, Uint8Array] {
  requireLength(secretX, KEY_BYTES);
  requireLength(secretY, KEY_BYTES);
  if (slotX === slotY) {
    throw new Error('unwrap failed');
  }
  return SLOT_ORDER.indexOf(slotX) < SLOT_ORDER.indexOf(slotY)
    ? [secretX, secretY]
    : [secretY, secretX];
}

function pairWrapKey(
  slotX: LetterKeeperSlot,
  secretX: Uint8Array,
  slotY: LetterKeeperSlot,
  secretY: Uint8Array,
  ctx: LetterKeeperPairContext,
): Uint8Array {
  const ordered = orderedSecretsForSlots(slotX, secretX, slotY, secretY);
  return hkdfSha256(ordered[0], ordered[1], pairInfo(ctx), KEY_BYTES);
}

function sealPair(
  shareP: Uint8Array,
  slotX: LetterKeeperSlot,
  secretX: Uint8Array,
  slotY: LetterKeeperSlot,
  secretY: Uint8Array,
  ctx: LetterKeeperPairContext,
  pair: LetterKeeperPairId,
): Uint8Array {
  const wrapKey = pairWrapKey(slotX, secretX, slotY, secretY, ctx);
  try {
    return sealXChaCha20Poly1305(wrapKey, shareP, pairAad(ctx, pair));
  } finally {
    wipe(wrapKey);
  }
}

export function createLetterKeeperPairBoxes(
  shareP: Uint8Array,
  secretA: Uint8Array,
  secretB: Uint8Array,
  secretC: Uint8Array,
  ctx: LetterKeeperPairContext,
): LetterKeeperPairBoxes {
  requireLength(shareP, KEY_BYTES);
  return {
    boxAb: sealPair(shareP, 'a', secretA, 'b', secretB, ctx, 'ab'),
    boxAc: sealPair(shareP, 'a', secretA, 'c', secretC, ctx, 'ac'),
    boxBc: sealPair(shareP, 'b', secretB, 'c', secretC, ctx, 'bc'),
  };
}

export function openLetterKeeperPair(
  box: Uint8Array,
  slotX: LetterKeeperSlot,
  secretX: Uint8Array,
  slotY: LetterKeeperSlot,
  secretY: Uint8Array,
  ctx: LetterKeeperPairContext,
  pair: LetterKeeperPairId,
): Uint8Array {
  const wrapKey = pairWrapKey(slotX, secretX, slotY, secretY, ctx);
  try {
    return openXChaCha20Poly1305(wrapKey, box, pairAad(ctx, pair));
  } finally {
    wipe(wrapKey);
  }
}

export function pairIdForSlots(
  slotX: LetterKeeperSlot,
  slotY: LetterKeeperSlot,
): LetterKeeperPairId {
  const ids = [slotX, slotY].sort().join('');
  if (ids === 'ab' || ids === 'ac' || ids === 'bc') {
    return ids;
  }
  throw new Error('unwrap failed');
}

export function openLetterKeeperWithHolders(
  boxes: LetterKeeperPairBoxes,
  holderX: { slot: LetterKeeperSlot; secret: Uint8Array },
  holderY: { slot: LetterKeeperSlot; secret: Uint8Array },
  ctx: LetterKeeperPairContext,
): Uint8Array {
  const pair = pairIdForSlots(holderX.slot, holderY.slot);
  const box =
    pair === 'ab' ? boxes.boxAb : pair === 'ac' ? boxes.boxAc : boxes.boxBc;
  return openLetterKeeperPair(
    box,
    holderX.slot,
    holderX.secret,
    holderY.slot,
    holderY.secret,
    ctx,
    pair,
  );
}

/** Seal a holder secret to a keeper's letterbox, pinning the recipient letterbox public key in AAD. */
export function wrapKeeperHolderToLetterbox(
  holderSecret: Uint8Array,
  keeperLetterboxPublic: Uint8Array,
  aad: LetterKeeperHolderAad,
): Uint8Array {
  return wrapSecretWithAad(
    holderSecret,
    keeperLetterboxPublic,
    encodeLetterKeeperHolderAad(aad),
  );
}

export function unwrapKeeperHolderFromLetterbox(
  wrapped: Uint8Array,
  keeperLetterboxPrivate: Uint8Array,
  aad: LetterKeeperHolderAad,
): Uint8Array {
  return unwrapSecretWithAad(
    wrapped,
    keeperLetterboxPrivate,
    encodeLetterKeeperHolderAad(aad),
  );
}

/**
 * Before rewrapping to the recipient, refuse if the server's current letterbox
 * public key does not match the key pinned at seal (byte-for-byte).
 */
export function assertPinnedRecipientLetterboxMatches(
  pinnedRecipientLetterboxPublic: Uint8Array,
  currentRecipientLetterboxPublic: Uint8Array,
): void {
  requireLength(pinnedRecipientLetterboxPublic, KEY_BYTES);
  requireLength(currentRecipientLetterboxPublic, KEY_BYTES);
  if (!secretsEqual(pinnedRecipientLetterboxPublic, currentRecipientLetterboxPublic)) {
    throw new Error('recipient key mismatch');
  }
}

/** Re-seal a holder secret to the recipient's letterbox (pinned key). */
export function wrapKeeperHolderToRecipientLetterbox(
  holderSecret: Uint8Array,
  recipientLetterboxPublic: Uint8Array,
  aad: LetterKeeperHolderAad,
): Uint8Array {
  assertPinnedRecipientLetterboxMatches(
    aad.pinnedRecipientLetterboxPublic,
    recipientLetterboxPublic,
  );
  return wrapSecretWithAad(
    holderSecret,
    recipientLetterboxPublic,
    encodeLetterKeeperHolderToRecipientAad(aad),
  );
}

export function unwrapKeeperHolderFromRecipientLetterbox(
  wrapped: Uint8Array,
  recipientLetterboxPrivate: Uint8Array,
  aad: LetterKeeperHolderAad,
): Uint8Array {
  return unwrapSecretWithAad(
    wrapped,
    recipientLetterboxPrivate,
    encodeLetterKeeperHolderToRecipientAad(aad),
  );
}

export function wipeLetterKeeperPairBoxes(boxes: LetterKeeperPairBoxes): void {
  wipe(boxes.boxAb);
  wipe(boxes.boxAc);
  wipe(boxes.boxBc);
}
