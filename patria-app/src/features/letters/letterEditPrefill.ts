// SECURITY REVIEW REQUIRED
/**
 * Edit-letter prefill: decrypt on device via the author share, keep plaintext
 * in memory only (never AsyncStorage, never log, never upload until reseal).
 */
import { wipe } from '../../lib/crypto/bytes';
import type { LetterTriggerKind, LetterVisibility } from './letterApi';
import { openLetterAsAuthor } from './letterOpen';

export type LetterEditBaseline = {
  body: string;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerKind: LetterTriggerKind;
  dateYmd: string;
  triggerAge: number | null;
  recipientId: string;
  hadVoice: boolean;
  voiceDurationSeconds: number | null;
  fingerprint: string;
  version: number;
};

export type LetterEditCurrent = {
  body: string;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerKind: LetterTriggerKind;
  dateYmd: string;
  triggerAge: number | null;
  recipientId: string | null;
  voiceDurationSeconds: number | null;
  hasVoice: boolean;
  voiceTouched: boolean;
};

/** True when Seal again would rewrite the same sealed content and metadata. */
export function letterEditIsUnchanged(
  baseline: LetterEditBaseline,
  current: LetterEditCurrent,
): boolean {
  if (current.voiceTouched) {
    return false;
  }
  if (current.body.trim() !== baseline.body.trim()) {
    return false;
  }
  if ((current.fromLabel.trim() || '') !== (baseline.fromLabel.trim() || '')) {
    return false;
  }
  if (current.visibility !== baseline.visibility) {
    return false;
  }
  if (current.triggerKind !== baseline.triggerKind) {
    return false;
  }
  if (current.triggerKind === 'date' && current.dateYmd !== baseline.dateYmd) {
    return false;
  }
  if (current.triggerKind === 'age' && current.triggerAge !== baseline.triggerAge) {
    return false;
  }
  if (current.recipientId !== baseline.recipientId) {
    return false;
  }
  if (current.hasVoice !== baseline.hadVoice) {
    return false;
  }
  if (baseline.hadVoice && current.voiceDurationSeconds !== baseline.voiceDurationSeconds) {
    return false;
  }
  return true;
}

export type PrefillForEditResult =
  | {
      ok: true;
      body: string;
      voicePlain: Uint8Array | null;
      voiceDurationSeconds: number | null;
      baseline: LetterEditBaseline;
    }
  | { ok: false; reason: 'missing' | 'not_ready' | 'failed' | 'no_author_share' };

/**
 * Decrypt the sealed letter for the author so Edit can show the real text.
 * Caller must wipe voicePlain when leaving the screen.
 */
export async function prefillLetterForEdit(input: {
  letterId: string;
  spaceId: string;
  userId: string;
  timeZone: string;
  dateYmdFromTrigger: (iso: string, timeZone: string) => string;
}): Promise<PrefillForEditResult> {
  const opened = await openLetterAsAuthor({
    letterId: input.letterId,
    spaceId: input.spaceId,
    userId: input.userId,
  });
  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason === 'need_keepers' ? 'failed' : opened.reason,
    };
  }
  const letter = opened.letter;
  const body = opened.content.body;
  const voiceDurationSeconds = opened.content.audio?.durationSeconds ?? null;
  const voicePlain = opened.voicePlain ?? null;
  // If content said there was audio but open failed to attach bytes, treat as no voice
  // rather than a half-attached note the author might reseal empty.
  const hadVoice = Boolean(voicePlain && voiceDurationSeconds != null);
  let dateYmd = '';
  if (letter.triggerKind === 'date') {
    if (!letter.triggerAt) {
      if (voicePlain) {
        wipe(voicePlain);
      }
      return { ok: false, reason: 'failed' };
    }
    try {
      dateYmd = input.dateYmdFromTrigger(letter.triggerAt, input.timeZone);
    } catch {
      if (voicePlain) {
        wipe(voicePlain);
      }
      return { ok: false, reason: 'failed' };
    }
  }
  return {
    ok: true,
    body,
    voicePlain: hadVoice ? voicePlain : null,
    voiceDurationSeconds: hadVoice ? voiceDurationSeconds : null,
    baseline: {
      body,
      fromLabel: letter.fromLabel,
      visibility: letter.visibility,
      triggerKind: letter.triggerKind,
      dateYmd,
      triggerAge: letter.triggerAge,
      recipientId: letter.recipientId,
      hadVoice,
      voiceDurationSeconds: hadVoice ? voiceDurationSeconds : null,
      fingerprint: opened.fingerprint,
      version: letter.version,
    },
  };
}
