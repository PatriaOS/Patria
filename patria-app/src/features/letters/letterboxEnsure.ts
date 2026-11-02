// SECURITY REVIEW REQUIRED
import { wipe } from '../../lib/crypto/bytes';
import {
  mintLetterboxForPersonalKey,
  unwrapLetterboxPrivateKey,
} from '../../lib/crypto/letterbox';
import { obtainPersonalKey } from '../../lib/crypto/personalKey';
import { fromPgBytea, toPgBytea } from '../../lib/crypto/pgBytea';
import { logKeyStep } from '../../lib/devLog';
import { supabase } from '../../lib/supabase';

/** Ensure this member has a letterbox key for the space. Creates personal key if needed. */
export async function ensureLetterboxKey(input: {
  spaceId: string;
  userId: string;
}): Promise<void> {
  const { data: existing, error } = await supabase
    .from('letterbox_keys')
    .select('user_id')
    .eq('family_space_id', input.spaceId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) {
    logKeyStep('letterbox_exists', error.code ?? 'unknown');
    throw error;
  }
  if (existing) {
    return;
  }

  const personalKey = await obtainPersonalKey({
    spaceId: input.spaceId,
    userId: input.userId,
  });
  try {
    const minted = mintLetterboxForPersonalKey(personalKey, {
      familySpaceId: input.spaceId,
      userId: input.userId,
    });
    try {
      const { error: createError } = await supabase.rpc('create_letterbox_key', {
        p_space_id: input.spaceId,
        p_public_key: toPgBytea(minted.publicKey),
        p_private_nonce: toPgBytea(minted.nonce),
        p_wrapped_private: toPgBytea(minted.wrappedPrivate),
      });
      if (createError) {
        logKeyStep('create_letterbox_key', createError.code ?? 'unknown');
        throw createError;
      }
    } finally {
      wipe(minted.privateKey);
      wipe(minted.publicKey);
    }
  } finally {
    wipe(personalKey);
  }
}

export async function fetchLetterboxPublicKey(
  spaceId: string,
  userId: string,
): Promise<Uint8Array | null> {
  const { data, error } = await supabase
    .from('letterbox_keys')
    .select('public_key')
    .eq('family_space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return fromPgBytea((data as { public_key: unknown }).public_key);
}

export async function loadOwnLetterboxPrivateKey(input: {
  spaceId: string;
  userId: string;
}): Promise<Uint8Array | null> {
  const { data, error } = await supabase
    .from('letterbox_keys')
    .select('private_nonce, wrapped_private')
    .eq('family_space_id', input.spaceId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const row = data as { private_nonce: unknown; wrapped_private: unknown };
  const personalKey = await obtainPersonalKey({
    spaceId: input.spaceId,
    userId: input.userId,
  });
  try {
    return unwrapLetterboxPrivateKey(
      personalKey,
      fromPgBytea(row.private_nonce),
      fromPgBytea(row.wrapped_private),
      { familySpaceId: input.spaceId, userId: input.userId },
    );
  } finally {
    wipe(personalKey);
  }
}
