// SECURITY REVIEW REQUIRED
import { bytesToHex } from '@noble/hashes/utils.js';

import { wipe } from '../../lib/crypto/bytes';
import {
  sealLetterAudio,
  sealLetterContent,
  wrapLetterCekToAuthorPersonalKey,
  wrapLetterShareToLetterbox,
  type LetterContent,
} from '../../lib/crypto/letterEnvelope';
import { sealSharePToReleasePublicKey } from '../../lib/crypto/letterReleaseKey';
import { splitLetterCek, wipeLetterShares } from '../../lib/crypto/letterSplit';
import { obtainPersonalKey } from '../../lib/crypto/personalKey';
import { randomUuid } from '../../lib/crypto/random';
import { logKeyStep } from '../../lib/devLog';
import { getLetterReleasePublicKey } from './letterReleaseConfig';
import { fetchLetterboxPublicKey } from './letterboxEnsure';
import {
  insertLetterDraft,
  sealLetter,
  type LetterTriggerKind,
  type LetterVisibility,
} from './letterApi';

export type SealLetterParams = {
  letterId: string;
  familySpaceId: string;
  authorId: string;
  recipientId: string;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerKind: LetterTriggerKind;
  /** Date letters only — age letters omit this; the server computes trigger_at. */
  triggerAt?: string | null;
  /** Age letters only (1–120). */
  triggerAge?: number | null;
  body: string;
  /** Optional voice note plaintext from VoiceNoteFieldNative. */
  voicePlain?: Uint8Array | null;
  voiceDurationSeconds?: number | null;
  /** Existing letter being re-sealed (version bumps). */
  previousVersion?: number;
  createDraft?: boolean;
};

export type SealLetterResult =
  | { ok: true; fingerprint: string; version: number }
  | {
      ok: false;
      reason:
        | 'recipient_not_ready'
        | 'too_large'
        | 'age_no_dob'
        | 'age_already'
        | 'failed';
      /** Short diagnostic for e2e only — never shown in production UI. */
      detail?: string;
      /** Recipient display name from server refusal (age seals). */
      recipientName?: string;
    };

function sealErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const row = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [row.message, row.details, row.hint, row.code]
      .filter((part) => typeof part === 'string' && part.trim())
      .map((part) => String(part).trim());
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }
  return String(error ?? '');
}

export async function sealLetterOnDevice(params: SealLetterParams): Promise<SealLetterResult> {
  const version = (params.previousVersion ?? 0) + 1;
  let personalKey: Uint8Array | undefined;
  let cek: Uint8Array | undefined;
  let voiceCiphertext: Uint8Array | undefined;
  try {
    if (params.createDraft !== false && !params.previousVersion) {
      // Drafts stay date-shaped until seal; age letters use a far placeholder
      // that seal_letter overwrites server-side (author never learns the day).
      const draftTriggerAt =
        params.triggerKind === 'date' && params.triggerAt
          ? params.triggerAt
          : '9999-01-01T00:00:00.000Z';
      await insertLetterDraft({
        id: params.letterId,
        familySpaceId: params.familySpaceId,
        authorId: params.authorId,
        recipientId: params.recipientId,
        fromLabel: params.fromLabel,
        visibility: params.visibility,
        triggerAt: draftTriggerAt,
      });
    }

    const letterboxPublic = await fetchLetterboxPublicKey(
      params.familySpaceId,
      params.recipientId,
    );
    if (!letterboxPublic) {
      return { ok: false, reason: 'recipient_not_ready' };
    }

    personalKey = await obtainPersonalKey({
      spaceId: params.familySpaceId,
      userId: params.authorId,
    });

    let content: LetterContent = { body: params.body };
    if (params.voicePlain && params.voicePlain.length > 0 && params.voiceDurationSeconds) {
      const audioId = randomUuid();
      const sealedAudio = sealLetterAudio(params.voicePlain, {
        familySpaceId: params.familySpaceId,
        letterId: params.letterId,
        audioId,
      });
      voiceCiphertext = sealedAudio.ciphertext;
      content = {
        body: params.body,
        audio: {
          id: audioId,
          fileKey: bytesToHex(sealedAudio.fileKey),
          nonce: bytesToHex(sealedAudio.nonce),
          durationSeconds: params.voiceDurationSeconds,
        },
      };
      wipe(sealedAudio.fileKey);
      wipe(sealedAudio.nonce);
    }

    const sealed = sealLetterContent(
      content,
      {
        familySpaceId: params.familySpaceId,
        letterId: params.letterId,
        version,
        authorId: params.authorId,
      },
      voiceCiphertext,
    );
    cek = sealed.cek;

    const authorWrap = wrapLetterCekToAuthorPersonalKey(personalKey, cek, {
      familySpaceId: params.familySpaceId,
      letterId: params.letterId,
      version,
      authorId: params.authorId,
    });

    const shares = splitLetterCek(cek);
    try {
      const recipientWrap = wrapLetterShareToLetterbox(shares.shareR, letterboxPublic, {
        letterId: params.letterId,
        version,
      });
      const releasePublic = getLetterReleasePublicKey();
      const patria = sealSharePToReleasePublicKey(shares.shareP, releasePublic, {
        letterId: params.letterId,
        version,
      });

      await sealLetter({
        letterId: params.letterId,
        version,
        fromLabel: params.fromLabel,
        visibility: params.visibility,
        triggerKind: params.triggerKind,
        triggerAt: params.triggerKind === 'date' ? (params.triggerAt ?? null) : null,
        triggerAge: params.triggerKind === 'age' ? (params.triggerAge ?? null) : null,
        contentNonce: sealed.contentNonce,
        ciphertext: sealed.ciphertext,
        voiceCiphertext: voiceCiphertext ?? null,
        contentHash: bytesToHex(sealed.contentHash),
        fingerprint: sealed.fingerprint,
        authorCekNonce: authorWrap.nonce,
        authorWrappedCek: authorWrap.wrappedCek,
        recipientWrappedShare: recipientWrap,
        patriaEphemeralPublic: patria.ephemeralPublicKey,
        patriaSealedShare: patria.sealedShare,
        voiceObjectPath: null,
      });

      return { ok: true, fingerprint: sealed.fingerprint, version };
    } finally {
      wipeLetterShares(shares);
    }
  } catch (error) {
    const message = sealErrorMessage(error);
    if (message.includes('too large')) {
      return { ok: false, reason: 'too_large' };
    }
    const noDob = /letter_age_no_dob:([^|\n]+)/.exec(message);
    if (noDob) {
      return {
        ok: false,
        reason: 'age_no_dob',
        recipientName: noDob[1]?.trim() || undefined,
      };
    }
    const already = /letter_age_already:([^|\n]+)/.exec(message);
    if (already) {
      return {
        ok: false,
        reason: 'age_already',
        recipientName: already[1]?.trim() || undefined,
      };
    }
    logKeyStep('seal_letter_failed', message.slice(0, 120) || 'unknown');
    return {
      ok: false,
      reason: 'failed',
      detail: message.slice(0, 160) || undefined,
    };
  } finally {
    if (personalKey) {
      wipe(personalKey);
    }
    if (cek) {
      wipe(cek);
    }
  }
}
