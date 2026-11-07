// SECURITY REVIEW REQUIRED
import { wipe } from '../../lib/crypto/bytes';
import {
  unwrapKeeperHolderFromLetterbox,
  wrapKeeperHolderToRecipientLetterbox,
} from '../../lib/crypto/letterKeeperBoxes';
import { logFailedAction } from '../../lib/devLog';
import {
  fetchLetterboxPublicKey,
  loadOwnLetterboxPrivateKey,
} from './letterboxEnsure';
import {
  fetchOwnKeeperRow,
  releaseKeeperHolderToRecipient,
} from './letterApi';

export type KeeperHelpResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'key_mismatch' | 'failed' };

/**
 * After due: unwrap this keeper's holder secret and re-seal it to the
 * recipient letterbox public key pinned at seal. Refuse if the server's
 * current recipient key does not match the pin.
 */
export async function helpRecipientOpenLetter(input: {
  letterId: string;
  version: number;
  spaceId: string;
  keeperUserId: string;
  recipientId: string;
}): Promise<KeeperHelpResult> {
  const row = await fetchOwnKeeperRow(input.letterId, input.version);
  if (!row) {
    return { ok: false, reason: 'missing' };
  }

  const currentRecipientPublic = await fetchLetterboxPublicKey(
    input.spaceId,
    input.recipientId,
  );
  if (!currentRecipientPublic) {
    return { ok: false, reason: 'failed' };
  }

  const letterboxPrivate = await loadOwnLetterboxPrivateKey({
    spaceId: input.spaceId,
    userId: input.keeperUserId,
  });
  if (!letterboxPrivate) {
    return { ok: false, reason: 'failed' };
  }

  let holder: Uint8Array | undefined;
  let rewrapped: Uint8Array | undefined;
  try {
    const aad = {
      letterId: input.letterId,
      version: input.version,
      keeperId: input.keeperUserId,
      pinnedRecipientLetterboxPublic: row.pinnedRecipientLetterboxPublic,
    };
    holder = unwrapKeeperHolderFromLetterbox(
      row.wrappedHolderSecret,
      letterboxPrivate,
      aad,
    );
    rewrapped = wrapKeeperHolderToRecipientLetterbox(holder, currentRecipientPublic, aad);
    await releaseKeeperHolderToRecipient(input.letterId, rewrapped);
    return { ok: true };
  } catch (error) {
    logFailedAction(error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('recipient key mismatch')) {
      return { ok: false, reason: 'key_mismatch' };
    }
    return { ok: false, reason: 'failed' };
  } finally {
    wipe(letterboxPrivate);
    if (holder) {
      wipe(holder);
    }
    if (rewrapped) {
      wipe(rewrapped);
    }
    wipe(row.wrappedHolderSecret);
    wipe(row.pinnedRecipientLetterboxPublic);
    wipe(currentRecipientPublic);
  }
}
