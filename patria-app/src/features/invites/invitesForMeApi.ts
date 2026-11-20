import type { SpaceRole } from '../../lib/roles';
import { supabase } from '../../lib/supabase';

export type InviteForMe = {
  id: string;
  familySpaceName: string;
  inviterDisplayName: string;
  role: SpaceRole;
  expiresAt: string;
};

export async function listInvitesForMe(): Promise<InviteForMe[]> {
  const { data, error } = await supabase.rpc('list_invites_for_me');
  if (error) {
    throw error;
  }
  type Row = {
    id: string;
    family_space_name: string;
    inviter_display_name: string;
    role: SpaceRole;
    expires_at: string;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    familySpaceName: r.family_space_name,
    inviterDisplayName: r.inviter_display_name,
    role: r.role,
    expiresAt: r.expires_at,
  }));
}

export async function inviteTokenForMe(inviteId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('invite_token_for_me', {
    p_invite_id: inviteId,
  });
  if (error) {
    throw error;
  }
  return typeof data === 'string' && data.length > 0 ? data : null;
}

export async function declineInviteForMe(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_invite_for_me', {
    p_invite_id: inviteId,
  });
  if (error) {
    throw error;
  }
}
