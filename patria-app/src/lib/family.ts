import { memberDisplayName } from './displayName';
import type { SpaceRole } from './roles';
import { supabase } from './supabase';

export type FamilySpace = {
  id: string;
  name: string;
};

export type MemberRow = {
  id: string;
  userId: string;
  role: SpaceRole;
  relationshipLabel: string | null;
  displayName: string;
};

export type ChildRow = {
  id: string;
  displayName: string;
  dateOfBirth: string | null;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: SpaceRole;
  expiresAt: string;
};

export type CircleOption = {
  id: string;
  name: string;
  kind: string;
};

export type InvitePreview = {
  family_space_name: string;
  role: SpaceRole;
  default_circle_name: string;
  expires_at: string;
  visibility_summary: string;
  inviter_display_name: string;
};

export async function fetchMemberships(
  userId: string,
): Promise<{ space: FamilySpace; role: SpaceRole }[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('role, family_spaces ( id, name )')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return (data ?? []).flatMap((row) => {
    const space = row.family_spaces as FamilySpace | FamilySpace[] | null;
    const one = Array.isArray(space) ? space[0] : space;
    if (!one) {
      return [];
    }
    return [{ space: one, role: row.role as SpaceRole }];
  });
}

export async function fetchMembers(spaceId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('id, user_id, role, relationship_label, profiles ( display_name )')
    .eq('family_space_id', spaceId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const profile = row.profiles as
      | { display_name: string }
      | { display_name: string }[]
      | null;
    const one = Array.isArray(profile) ? profile[0] : profile;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      role: row.role as SpaceRole,
      relationshipLabel: row.relationship_label as string | null,
      displayName: memberDisplayName(one?.display_name),
    };
  });
}

export async function fetchOwnDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data?.display_name ?? null;
}

export async function fetchAdminMemberEmail(
  spaceId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('admin_member_email', {
    p_space_id: spaceId,
    p_user_id: userId,
  });
  if (error) {
    return null;
  }
  return typeof data === 'string' && data.length > 0 ? data : null;
}

export async function fetchChildren(spaceId: string): Promise<ChildRow[]> {
  const { data, error } = await supabase
    .from('child_profiles')
    .select('id, display_name, date_of_birth')
    .eq('family_space_id', spaceId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
    dateOfBirth: row.date_of_birth as string | null,
  }));
}

export async function fetchPendingInvites(spaceId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, email, role, expires_at, status')
    .eq('family_space_id', spaceId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    role: row.role as SpaceRole,
    expiresAt: row.expires_at as string,
  }));
}

export async function fetchInviteShareToken(inviteId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('invites')
    .select('token')
    .eq('id', inviteId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const token = data.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function fetchInviteCircles(spaceId: string): Promise<CircleOption[]> {
  const { data, error } = await supabase
    .from('circles')
    .select('id, name, kind')
    .eq('family_space_id', spaceId)
    .in('kind', ['household', 'extended_family', 'close_friends']);

  if (error) {
    throw error;
  }

  return (data ?? []) as CircleOption[];
}

export async function fetchCircles(spaceId: string): Promise<CircleOption[]> {
  const { data, error } = await supabase
    .from('circles')
    .select('id, name, kind')
    .eq('family_space_id', spaceId);

  if (error) {
    throw error;
  }

  return (data ?? []) as CircleOption[];
}

export async function householdCircleId(spaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('circles')
    .select('id')
    .eq('family_space_id', spaceId)
    .eq('kind', 'household')
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data?.id ?? null;
}
