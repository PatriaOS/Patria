// SECURITY REVIEW REQUIRED
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { wipe } from '../../lib/crypto/bytes';
import {
  hashLetterSealedPayload,
  letterFingerprint,
  openLetterAudio,
  openLetterContent,
  unwrapLetterCekFromAuthorPersonalKey,
  unwrapLetterShareFromLetterbox,
  type LetterContent,
} from '../../lib/crypto/letterEnvelope';
import {
  openLetterKeeperPair,
  pairIdForSlots,
  unwrapKeeperHolderFromRecipientLetterbox,
  type LetterKeeperSlot,
} from '../../lib/crypto/letterKeeperBoxes';
import { combineLetterCek } from '../../lib/crypto/letterSplit';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';
import { logFailedAction } from '../../lib/devLog';
import { fetchLetterboxPublicKey, loadOwnLetterboxPrivateKey } from './letterboxEnsure';
import {
  claimPatriaShareP,
  fetchAuthorShare,
  fetchLetter,
  fetchLetterKeeperHelp,
  fetchLetterKeeperPairBox,
  fetchLetterPayload,
  fetchRecipientShare,
  type LetterRow,
} from './letterApi';

export type OpenLetterResult =
  | {
      ok: true;
      content: LetterContent;
      fingerprint: string;
      matches: boolean;
      letter: LetterRow;
      voicePlain?: Uint8Array;
    }
  | {
      ok: false;
      reason: 'missing' | 'not_ready' | 'failed' | 'no_author_share' | 'need_keepers';
      /** Short step tag for e2e / dev — never a secret. */
      detail?: string;
    };

async function attachVoicePlain(
  content: LetterContent,
  letter: LetterRow,
  voiceCiphertext: Uint8Array | null,
): Promise<{ content: LetterContent; voicePlain?: Uint8Array }> {
  if (!content.audio || !voiceCiphertext) {
    return { content };
  }
  const fileKey = hexToBytes(content.audio.fileKey);
  const nonce = hexToBytes(content.audio.nonce);
  try {
    const voicePlain = openLetterAudio(fileKey, nonce, voiceCiphertext, {
      familySpaceId: letter.familySpaceId,
      letterId: letter.id,
      audioId: content.audio.id,
    });
    return { content, voicePlain };
  } finally {
    wipe(fileKey);
    wipe(nonce);
  }
}

export async function openLetterAsAuthor(input: {
  letterId: string;
  spaceId: string;
  userId: string;
}): Promise<OpenLetterResult> {
  const letter = await fetchLetter(input.letterId);
  if (!letter || letter.authorId !== input.userId) {
    return { ok: false, reason: 'missing' };
  }
  const share = await fetchAuthorShare(input.letterId);
  if (!share) {
    return { ok: false, reason: 'no_author_share' };
  }
  const payload = await fetchLetterPayload(input.letterId);
  if (!payload) {
    return { ok: false, reason: 'missing' };
  }
  const personalKey = await loadPersonalKeyIfPresent({
    spaceId: input.spaceId,
    userId: input.userId,
  });
  if (!personalKey) {
    return { ok: false, reason: 'failed' };
  }
  let cek: Uint8Array | undefined;
  try {
    cek = unwrapLetterCekFromAuthorPersonalKey(personalKey, share.cekNonce, share.wrappedCek, {
      familySpaceId: letter.familySpaceId,
      letterId: letter.id,
      version: share.version,
      authorId: letter.authorId,
    });
    const content = openLetterContent(cek, payload.contentNonce, payload.ciphertext, {
      familySpaceId: letter.familySpaceId,
      letterId: letter.id,
      version: payload.version,
      authorId: letter.authorId,
    });
    const withVoice = await attachVoicePlain(content, letter, payload.voiceCiphertext);
    const hash = hashLetterSealedPayload(payload.ciphertext, payload.voiceCiphertext ?? undefined);
    const fingerprint = letterFingerprint(hash);
    const matches = letter.fingerprint === fingerprint;
    return {
      ok: true,
      content: withVoice.content,
      fingerprint,
      matches,
      letter,
      voicePlain: withVoice.voicePlain,
    };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    wipe(personalKey);
    if (cek) {
      wipe(cek);
    }
  }
}

export async function openLetterAsRecipient(input: {
  letterId: string;
  spaceId: string;
  userId: string;
}): Promise<OpenLetterResult> {
  const letter = await fetchLetter(input.letterId);
  if (!letter || letter.recipientId !== input.userId) {
    return { ok: false, reason: 'missing' };
  }
  if (letter.status !== 'pending' && letter.status !== 'released') {
    return { ok: false, reason: 'not_ready' };
  }
  const wrapped = await fetchRecipientShare(input.letterId);
  if (!wrapped) {
    return { ok: false, reason: 'failed' };
  }
  const letterboxPrivate = await loadOwnLetterboxPrivateKey({
    spaceId: input.spaceId,
    userId: input.userId,
  });
  if (!letterboxPrivate) {
    return { ok: false, reason: 'failed' };
  }
  const payload = await fetchLetterPayload(input.letterId);
  if (!payload) {
    wipe(letterboxPrivate);
    return { ok: false, reason: 'missing' };
  }

  let shareR: Uint8Array | undefined;
  let shareP: Uint8Array | undefined;
  let cek: Uint8Array | undefined;
  try {
    shareR = unwrapLetterShareFromLetterbox(wrapped, letterboxPrivate, {
      letterId: letter.id,
      version: letter.version,
    });
    try {
      const sharePHex = await claimPatriaShareP(letter.id);
      shareP = hexToBytes(sharePHex);
    } catch (autoError) {
      // Automatic path failed — caller may offer the keeper path (no app flag).
      logFailedAction(autoError);
      return { ok: false, reason: 'need_keepers' };
    }
    cek = combineLetterCek(shareR, shareP);
    const content = openLetterContent(cek, payload.contentNonce, payload.ciphertext, {
      familySpaceId: letter.familySpaceId,
      letterId: letter.id,
      version: payload.version,
      authorId: letter.authorId,
    });
    const withVoice = await attachVoicePlain(content, letter, payload.voiceCiphertext);
    const hash = hashLetterSealedPayload(payload.ciphertext, payload.voiceCiphertext ?? undefined);
    const fingerprint = letterFingerprint(hash);
    const expected = letter.fingerprint ?? '';
    const matches = expected === fingerprint || expected === bytesToHex(hash).slice(0, 12);
    return {
      ok: true,
      content: withVoice.content,
      fingerprint,
      matches,
      letter,
      voicePlain: withVoice.voicePlain,
    };
  } catch (error) {
    // UI stays generic ("We couldn't open this letter."); reason code is dev-only.
    logFailedAction(error);
    return { ok: false, reason: 'failed' };
  } finally {
    wipe(letterboxPrivate);
    if (shareR) {
      wipe(shareR);
    }
    if (shareP) {
      wipe(shareP);
    }
    if (cek) {
      wipe(cek);
    }
  }
}

/** Open after two keepers have re-sealed their holder secrets to the recipient. */
export async function openLetterAsRecipientWithKeepers(input: {
  letterId: string;
  spaceId: string;
  userId: string;
}): Promise<OpenLetterResult> {
  const letter = await fetchLetter(input.letterId);
  if (!letter || letter.recipientId !== input.userId) {
    return { ok: false, reason: 'missing' };
  }
  if (letter.status !== 'pending' && letter.status !== 'released') {
    return { ok: false, reason: 'not_ready' };
  }
  // Prefer the letter's own space — shared-sim e2e can leave a stale current spaceId.
  const spaceId = letter.familySpaceId || input.spaceId;
  const wrapped = await fetchRecipientShare(input.letterId);
  if (!wrapped) {
    return { ok: false, reason: 'failed', detail: 'no_share_r' };
  }
  let letterboxPrivate: Uint8Array | null;
  try {
    letterboxPrivate = await loadOwnLetterboxPrivateKey({
      spaceId,
      userId: input.userId,
    });
  } catch (error) {
    logFailedAction(error);
    return { ok: false, reason: 'failed', detail: 'letterbox_load' };
  }
  if (!letterboxPrivate) {
    return { ok: false, reason: 'failed', detail: 'no_letterbox' };
  }
  const recipientPublic = await fetchLetterboxPublicKey(spaceId, input.userId);
  if (!recipientPublic) {
    wipe(letterboxPrivate);
    return { ok: false, reason: 'failed', detail: 'no_letterbox_pub' };
  }
  const payload = await fetchLetterPayload(input.letterId);
  if (!payload) {
    wipe(letterboxPrivate);
    wipe(recipientPublic);
    return { ok: false, reason: 'missing', detail: 'no_payload' };
  }

  const help = await fetchLetterKeeperHelp(input.letterId);
  const helped = help.filter((row) => row.hasHelped && row.wrappedHolderSecret);
  if (helped.length < 2) {
    wipe(letterboxPrivate);
    wipe(recipientPublic);
    return {
      ok: false,
      reason: 'need_keepers',
      detail: `helped=${helped.length}`,
    };
  }

  let shareR: Uint8Array | undefined;
  let shareP: Uint8Array | undefined;
  let cek: Uint8Array | undefined;
  const openedHolders: Uint8Array[] = [];
  try {
    try {
      shareR = unwrapLetterShareFromLetterbox(wrapped, letterboxPrivate, {
        letterId: letter.id,
        version: letter.version,
      });
    } catch (error) {
      logFailedAction(error);
      return { ok: false, reason: 'failed', detail: 'unwrap_share_r' };
    }

    const first = helped[0]!;
    const second = helped[1]!;
    for (const row of [first, second]) {
      try {
        const holder = unwrapKeeperHolderFromRecipientLetterbox(
          row.wrappedHolderSecret!,
          letterboxPrivate,
          {
            letterId: letter.id,
            version: letter.version,
            keeperId: row.keeperId,
            pinnedRecipientLetterboxPublic: recipientPublic,
          },
        );
        openedHolders.push(holder);
      } catch (error) {
        logFailedAction(error);
        return {
          ok: false,
          reason: 'failed',
          detail: `unwrap_holder_${row.slot}`,
        };
      }
    }

    const pairId = pairIdForSlots(first.slot as LetterKeeperSlot, second.slot as LetterKeeperSlot);
    const pairBox = await fetchLetterKeeperPairBox(letter.id, pairId);
    if (!pairBox) {
      return { ok: false, reason: 'failed', detail: `no_pair_${pairId}` };
    }
    try {
      shareP = openLetterKeeperPair(
        pairBox.sealedShareP,
        first.slot as LetterKeeperSlot,
        openedHolders[0]!,
        second.slot as LetterKeeperSlot,
        openedHolders[1]!,
        { letterId: letter.id, version: letter.version },
        pairId,
      );
    } catch (error) {
      logFailedAction(error);
      return { ok: false, reason: 'failed', detail: `open_pair_${pairId}` };
    }
    cek = combineLetterCek(shareR, shareP);
    const content = openLetterContent(cek, payload.contentNonce, payload.ciphertext, {
      familySpaceId: letter.familySpaceId,
      letterId: letter.id,
      version: payload.version,
      authorId: letter.authorId,
    });
    const withVoice = await attachVoicePlain(content, letter, payload.voiceCiphertext);
    const hash = hashLetterSealedPayload(payload.ciphertext, payload.voiceCiphertext ?? undefined);
    const fingerprint = letterFingerprint(hash);
    const expected = letter.fingerprint ?? '';
    const matches = expected === fingerprint || expected === bytesToHex(hash).slice(0, 12);
    return {
      ok: true,
      content: withVoice.content,
      fingerprint,
      matches,
      letter,
      voicePlain: withVoice.voicePlain,
    };
  } catch (error) {
    logFailedAction(error);
    return { ok: false, reason: 'failed', detail: 'open_keepers' };
  } finally {
    wipe(letterboxPrivate);
    wipe(recipientPublic);
    for (const h of openedHolders) {
      wipe(h);
    }
    for (const row of helped) {
      if (row.wrappedHolderSecret) {
        wipe(row.wrappedHolderSecret);
      }
    }
    if (shareR) {
      wipe(shareR);
    }
    if (shareP) {
      wipe(shareP);
    }
    if (cek) {
      wipe(cek);
    }
  }
}
