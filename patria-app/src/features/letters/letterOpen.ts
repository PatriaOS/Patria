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
import { combineLetterCek } from '../../lib/crypto/letterSplit';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';
import { loadOwnLetterboxPrivateKey } from './letterboxEnsure';
import {
  claimPatriaShareP,
  fetchAuthorShare,
  fetchLetter,
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
  | { ok: false; reason: 'missing' | 'not_ready' | 'failed' | 'no_author_share' };

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
    const sharePHex = await claimPatriaShareP(letter.id);
    shareP = hexToBytes(sharePHex);
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
  } catch {
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
