// SECURITY REVIEW REQUIRED
import { bytesToHex } from '@noble/hashes/utils.js';
import { secretsEqual, wipe } from '../../lib/crypto/bytes';
import {
  unwrapKeeperHolderFromLetterbox,
  wrapKeeperHolderToRecipientLetterbox,
} from '../../lib/crypto/letterKeeperBoxes';
import { requireX25519PublicKey } from '../../lib/crypto/pgBytea';
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
  | {
      ok: false;
      reason:
        | 'missing'
        | 'key_mismatch'
        | 'failed'
        | 'no_letterbox'
        | 'unwrap'
        | 'not_due'
        | 'rpc';
      /** Short hex prefixes for diagnosing pin vs current mismatches (dev/e2e). */
      detail?: string;
    };

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
  let row: Awaited<ReturnType<typeof fetchOwnKeeperRow>> = null;
  let currentRecipientPublic: Uint8Array | null = null;
  let letterboxPrivate: Uint8Array | null = null;
  let holder: Uint8Array | undefined;
  let rewrapped: Uint8Array | undefined;
  try {
    row = await fetchOwnKeeperRow(input.letterId, input.version);
    if (!row) {
      return { ok: false, reason: 'missing' };
    }
    const keeperRow = row;

    currentRecipientPublic = await fetchLetterboxPublicKey(
      input.spaceId,
      input.recipientId,
    );
    if (!currentRecipientPublic) {
      return { ok: false, reason: 'failed' };
    }
    let pinned: Uint8Array;
    let current: Uint8Array;
    try {
      pinned = requireX25519PublicKey(keeperRow.pinnedRecipientLetterboxPublic);
      current = requireX25519PublicKey(currentRecipientPublic);
    } catch {
      return { ok: false, reason: 'failed' };
    }
    if (!secretsEqual(pinned, current)) {
      return {
        ok: false,
        reason: 'key_mismatch',
        detail: `${bytesToHex(pinned).slice(0, 8)}/${bytesToHex(current).slice(0, 8)}`,
      };
    }

    try {
      letterboxPrivate = await loadOwnLetterboxPrivateKey({
        spaceId: input.spaceId,
        userId: input.keeperUserId,
      });
    } catch (error) {
      logFailedAction(error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: 'no_letterbox',
        detail: message.slice(0, 64),
      };
    }
    if (!letterboxPrivate) {
      return { ok: false, reason: 'no_letterbox', detail: 'missing_row' };
    }

    const aad = {
      letterId: input.letterId,
      version: input.version,
      keeperId: input.keeperUserId,
      pinnedRecipientLetterboxPublic: keeperRow.pinnedRecipientLetterboxPublic,
    };
    try {
      holder = unwrapKeeperHolderFromLetterbox(
        keeperRow.wrappedHolderSecret,
        letterboxPrivate,
        aad,
      );
    } catch (error) {
      logFailedAction(error);
      return { ok: false, reason: 'unwrap' };
    }
    // Re-seal to the pinned key (matches what the recipient still holds).
    rewrapped = wrapKeeperHolderToRecipientLetterbox(
      holder,
      keeperRow.pinnedRecipientLetterboxPublic,
      aad,
    );
    try {
      await releaseKeeperHolderToRecipient(input.letterId, rewrapped);
    } catch (error) {
      logFailedAction(error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('recipient key mismatch')) {
        return { ok: false, reason: 'key_mismatch' };
      }
      // release_keeper_holder_to_recipient raises not_allowed before due.
      if (message.includes('not_allowed') || message.includes('42501')) {
        return { ok: false, reason: 'not_due' };
      }
      return { ok: false, reason: 'rpc' };
    }
    return { ok: true };
  } catch (error) {
    logFailedAction(error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('recipient key mismatch')) {
      return { ok: false, reason: 'key_mismatch' };
    }
    return { ok: false, reason: 'failed' };
  } finally {
    if (letterboxPrivate) {
      wipe(letterboxPrivate);
    }
    if (holder) {
      wipe(holder);
    }
    if (rewrapped) {
      wipe(rewrapped);
    }
    if (row) {
      wipe(row.wrappedHolderSecret);
      wipe(row.pinnedRecipientLetterboxPublic);
    }
    if (currentRecipientPublic) {
      wipe(currentRecipientPublic);
    }
  }
}
