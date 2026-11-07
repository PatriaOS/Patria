import { fromPgBytea, toPgBytea } from '../../lib/crypto/pgBytea';
import { supabase } from '../../lib/supabase';

export type LetterVisibility = 'surprise' | 'announced';
export type LetterStatus = 'draft' | 'sealed' | 'pending' | 'released' | 'withdrawn';
export type LetterTriggerKind = 'date' | 'age';

export type LetterRow = {
  id: string;
  familySpaceId: string;
  authorId: string;
  recipientId: string;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerKind: LetterTriggerKind;
  triggerAge: number | null;
  /** Null for age-letter authors (server redacts via letters_for_api). */
  triggerAt: string | null;
  status: LetterStatus;
  version: number;
  contentHash: string | null;
  fingerprint: string | null;
  voiceObjectPath: string | null;
  recipientLeftAt: string | null;
  sealedAt: string | null;
  pendingAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LetterDb = {
  id: string;
  family_space_id: string;
  author_id: string;
  recipient_id: string;
  from_label: string;
  visibility: string;
  trigger_kind: string;
  trigger_age: number | null;
  trigger_at: string | null;
  status: string;
  version: number;
  content_hash: string | null;
  fingerprint: string | null;
  voice_object_path: string | null;
  recipient_left_at: string | null;
  sealed_at: string | null;
  pending_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
};

/** SELECT via letters_for_api so age authors never receive trigger_at / DOB snapshot. */
const LETTER_COLUMNS =
  'id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_kind, trigger_age, trigger_at, status, version, content_hash, fingerprint, voice_object_path, recipient_left_at, sealed_at, pending_at, released_at, created_at, updated_at';

function asVisibility(value: string): LetterVisibility {
  return value === 'announced' ? 'announced' : 'surprise';
}

function asTriggerKind(value: string): LetterTriggerKind {
  return value === 'age' ? 'age' : 'date';
}

function asStatus(value: string): LetterStatus {
  if (
    value === 'draft' ||
    value === 'sealed' ||
    value === 'pending' ||
    value === 'released' ||
    value === 'withdrawn'
  ) {
    return value;
  }
  return 'draft';
}

function fromRow(row: LetterDb): LetterRow {
  return {
    id: row.id,
    familySpaceId: row.family_space_id,
    authorId: row.author_id,
    recipientId: row.recipient_id,
    fromLabel: row.from_label,
    visibility: asVisibility(row.visibility),
    triggerKind: asTriggerKind(row.trigger_kind),
    triggerAge: row.trigger_age == null ? null : Number(row.trigger_age),
    triggerAt: row.trigger_at,
    status: asStatus(row.status),
    version: row.version,
    contentHash: row.content_hash,
    fingerprint: row.fingerprint,
    voiceObjectPath: row.voice_object_path,
    recipientLeftAt: row.recipient_left_at,
    sealedAt: row.sealed_at,
    pendingAt: row.pending_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchLetters(spaceId: string): Promise<LetterRow[]> {
  const { data, error } = await supabase
    .from('letters_for_api')
    .select(LETTER_COLUMNS)
    .eq('family_space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return ((data ?? []) as LetterDb[]).map(fromRow);
}

export async function fetchLetter(letterId: string): Promise<LetterRow | null> {
  const { data, error } = await supabase
    .from('letters_for_api')
    .select(LETTER_COLUMNS)
    .eq('id', letterId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? fromRow(data as LetterDb) : null;
}

export async function insertLetterDraft(input: {
  id: string;
  familySpaceId: string;
  authorId: string;
  recipientId: string;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerAt: string;
}): Promise<void> {
  const { error } = await supabase.from('letters').insert({
    id: input.id,
    family_space_id: input.familySpaceId,
    author_id: input.authorId,
    recipient_id: input.recipientId,
    from_label: input.fromLabel,
    visibility: input.visibility,
    trigger_at: input.triggerAt,
    status: 'draft',
  });
  if (error) {
    throw error;
  }
}

export type SealLetterInput = {
  letterId: string;
  version: number;
  fromLabel: string;
  visibility: LetterVisibility;
  triggerKind: LetterTriggerKind;
  /** Required for date letters; ignored for age (server computes). */
  triggerAt: string | null;
  /** Required for age letters (1–120). */
  triggerAge: number | null;
  contentNonce: Uint8Array;
  ciphertext: Uint8Array;
  voiceCiphertext: Uint8Array | null;
  contentHash: string;
  fingerprint: string;
  authorCekNonce: Uint8Array;
  authorWrappedCek: Uint8Array;
  recipientWrappedShare: Uint8Array;
  patriaEphemeralPublic: Uint8Array;
  patriaSealedShare: Uint8Array;
  voiceObjectPath: string | null;
};

export async function sealLetter(input: SealLetterInput): Promise<void> {
  const { error } = await supabase.rpc('seal_letter', {
    p_letter_id: input.letterId,
    p_version: input.version,
    p_from_label: input.fromLabel,
    p_visibility: input.visibility,
    p_trigger_at: input.triggerAt,
    p_content_nonce: toPgBytea(input.contentNonce),
    p_ciphertext: toPgBytea(input.ciphertext),
    p_voice_ciphertext: input.voiceCiphertext ? toPgBytea(input.voiceCiphertext) : null,
    p_content_hash: input.contentHash,
    p_fingerprint: input.fingerprint,
    p_author_cek_nonce: toPgBytea(input.authorCekNonce),
    p_author_wrapped_cek: toPgBytea(input.authorWrappedCek),
    p_recipient_wrapped_share: toPgBytea(input.recipientWrappedShare),
    p_patria_ephemeral_public: toPgBytea(input.patriaEphemeralPublic),
    p_patria_sealed_share: toPgBytea(input.patriaSealedShare),
    p_keepers_may_release_early: false,
    p_voice_object_path: input.voiceObjectPath,
    p_trigger_kind: input.triggerKind,
    p_trigger_age: input.triggerAge,
  });
  if (error) {
    throw error;
  }
}

export async function withdrawLetter(letterId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_letter', { p_letter_id: letterId });
  if (error) {
    throw error;
  }
}

/** Author-only. While sealed, change the open day without resealing body or shares. */
export async function setLetterOpenDate(letterId: string, triggerAt: string): Promise<void> {
  const { error } = await supabase.rpc('set_letter_open_date', {
    p_letter_id: letterId,
    p_trigger_at: triggerAt,
  });
  if (error) {
    throw error;
  }
}

/** Author-only. While sealed, change age; server recomputes from the frozen DOB snapshot. */
export async function setLetterAge(letterId: string, triggerAge: number): Promise<void> {
  const { error } = await supabase.rpc('set_letter_age', {
    p_letter_id: letterId,
    p_trigger_age: triggerAge,
  });
  if (error) {
    throw error;
  }
}

/** Own or admin-readable birthday (YYYY-MM-DD), or null if unset / not allowed. */
export async function fetchProfileDateOfBirth(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('profile_date_of_birth', {
    p_user_id: userId,
  });
  if (error) {
    throw error;
  }
  if (data == null || data === '') {
    return null;
  }
  return String(data);
}

export async function updateOwnDateOfBirth(userId: string, dateOfBirth: string | null): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ date_of_birth: dateOfBirth, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    throw error;
  }
}

export async function leaveFamilyWithLetters(input: {
  spaceId: string;
  withdrawLetterIds: string[];
}): Promise<void> {
  const { error } = await supabase.rpc('leave_family_with_letters', {
    p_space_id: input.spaceId,
    p_withdraw_letter_ids: input.withdrawLetterIds,
  });
  if (error) {
    throw error;
  }
}

export async function fetchLetterPayload(letterId: string): Promise<{
  version: number;
  contentNonce: Uint8Array;
  ciphertext: Uint8Array;
  voiceCiphertext: Uint8Array | null;
} | null> {
  const { data, error } = await supabase
    .from('letter_payloads')
    .select('version, content_nonce, ciphertext, voice_ciphertext')
    .eq('letter_id', letterId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const row = data as {
    version: number;
    content_nonce: unknown;
    ciphertext: unknown;
    voice_ciphertext: unknown;
  };
  return {
    version: row.version,
    contentNonce: fromPgBytea(row.content_nonce),
    ciphertext: fromPgBytea(row.ciphertext),
    voiceCiphertext: row.voice_ciphertext ? fromPgBytea(row.voice_ciphertext) : null,
  };
}

export async function fetchAuthorShare(letterId: string): Promise<{
  version: number;
  cekNonce: Uint8Array;
  wrappedCek: Uint8Array;
} | null> {
  const { data, error } = await supabase
    .from('letter_author_shares')
    .select('version, cek_nonce, wrapped_cek')
    .eq('letter_id', letterId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const row = data as { version: number; cek_nonce: unknown; wrapped_cek: unknown };
  return {
    version: row.version,
    cekNonce: fromPgBytea(row.cek_nonce),
    wrappedCek: fromPgBytea(row.wrapped_cek),
  };
}

export async function fetchRecipientShare(letterId: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase
    .from('letter_recipient_shares')
    .select('wrapped_share')
    .eq('letter_id', letterId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return fromPgBytea((data as { wrapped_share: unknown }).wrapped_share);
}

export async function letterRecipientReady(spaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('letter_recipient_ready', {
    _space_id: spaceId,
    _user_id: userId,
  });
  if (error) {
    throw error;
  }
  return Boolean(data);
}

export async function letterWriterReady(spaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('letter_writer_ready', {
    _space_id: spaceId,
    _user_id: userId,
  });
  if (error) {
    throw error;
  }
  return Boolean(data);
}


export async function fetchFamilyTimezone(spaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('family_spaces')
    .select('timezone')
    .eq('id', spaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? String((data as { timezone: string }).timezone) : null;
}

async function letterReleaseReasonFromInvokeError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: unknown };
        if (typeof body?.error === 'string' && body.error.trim()) {
          return body.error.trim();
        }
      } catch {
        // ignore parse failures — fall through
      }
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return 'invoke_failed';
  }
  return 'invoke_failed';
}

/** Calls hosted/local letter-release. Throws Error whose message is a safe reason code. */
export async function claimPatriaShareP(letterId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('letter-release', {
    body: { letter_id: letterId },
  });
  if (error) {
    throw new Error(await letterReleaseReasonFromInvokeError(error));
  }
  const payload = data as { share_p_hex?: string; error?: string } | null;
  if (!payload?.share_p_hex) {
    throw new Error(payload?.error?.trim() || 'open_failed');
  }
  return payload.share_p_hex;
}
