import { leaveFamilyWithLetters } from '../features/letters/letterApi';
import { logFailedAction } from './devLog';
import { discardLocalFamilySecrets } from './crypto/keyStore';
import { supabase } from './supabase';

/**
 * Leaves the family. When `withdrawLetterIds` is given, the leave goes through
 * `leave_family_with_letters`: it deletes those letters for good, drops the
 * author's reread access to the sealed letters that stay, then removes the membership.
 */
export async function leaveFamilySpace(input: {
  spaceId: string;
  userId: string;
  withdrawLetterIds?: string[];
}): Promise<{ ok: true } | { ok: false }> {
  if (input.withdrawLetterIds) {
    try {
      await leaveFamilyWithLetters({
        spaceId: input.spaceId,
        withdrawLetterIds: input.withdrawLetterIds,
      });
    } catch (error) {
      logFailedAction(error);
      return { ok: false };
    }
  } else {
    const { error } = await supabase
      .from('space_members')
      .delete()
      .eq('family_space_id', input.spaceId)
      .eq('user_id', input.userId);
    if (error) {
      logFailedAction(error);
      return { ok: false };
    }
  }
  await discardLocalFamilySecrets(input.userId, input.spaceId);
  return { ok: true };
}
