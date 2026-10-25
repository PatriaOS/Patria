// SECURITY REVIEW REQUIRED
import { isRecoveryContactRole, type SpaceRole } from '../roles';
import { logKeyStep } from '../devLog';
import { supabase } from '../supabase';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';

export type RecoveryContactStatus = 'pending' | 'accepted' | 'declined';
export type RecoverySlot = 'a' | 'b';

export type RecoveryContactRow = {
  id: string;
  spaceId: string;
  memberId: string;
  userId: string;
  slot: RecoverySlot;
  status: RecoveryContactStatus;
};

export type ApprovedDevice = {
  deviceId: string;
  publicKey: Uint8Array;
};

export type RecoveryAccessGateway = {
  fetchMeta(
    spaceId: string,
  ): Promise<{ keyEpoch: number; recoveryKeyEpoch: number } | null>;
  fetchOwnRecoveryPublic(
    spaceId: string,
    userId: string,
  ): Promise<{ publicKey: Uint8Array; recoveryKeyEpoch: number } | null>;
  listContacts(spaceId: string): Promise<RecoveryContactRow[]>;
  inviteContact(input: {
    spaceId: string;
    memberId: string;
    userId: string;
    slot: RecoverySlot;
    createdBy: string;
  }): Promise<void>;
  setContactStatus(
    spaceId: string,
    userId: string,
    status: 'accepted' | 'declined',
  ): Promise<void>;
  deleteContact(spaceId: string, userId: string): Promise<void>;
  listApprovedDevices(spaceId: string, userId: string): Promise<ApprovedDevice[]>;
  listRecoveryContactPublicKeys(
    spaceId: string,
    contactUserId: string,
  ): Promise<ApprovedDevice[]>;
  listEligibleRecoveryContacts(
    spaceId: string,
  ): Promise<{ userId: string; displayName: string }[]>;
  upsertFamilyKeyUnderRecovery(input: {
    spaceId: string;
    userId: string;
    keyEpoch: number;
    wrappedFamilyKey: Uint8Array;
  }): Promise<void>;
  insertRecoveryPublicKey(input: {
    spaceId: string;
    userId: string;
    publicKey: Uint8Array;
    recoveryKeyEpoch: number;
    personalSeal?: Uint8Array | null;
  }): Promise<void>;
  insertHolderSecret(input: {
    spaceId: string;
    memberId: string;
    userId: string;
    deviceId: string;
    wrappedSecret: Uint8Array;
    recoveryKeyEpoch: number;
  }): Promise<void>;
  insertPairWrap(input: {
    spaceId: string;
    userId: string;
    recoveryKeyEpoch: number;
    pairId: 'ab' | 'ap' | 'bp';
    wrappedRecoveryKey: Uint8Array;
  }): Promise<void>;
  listPairIds(spaceId: string, userId: string, recoveryKeyEpoch: number): Promise<string[]>;
  fetchPairWraps(
    spaceId: string,
    userId: string,
    recoveryKeyEpoch: number,
  ): Promise<{ pairId: string; wrappedRecoveryKey: Uint8Array }[]>;
  purgeCiphertext(spaceId: string): Promise<void>;
};

function parseSlot(value: unknown): RecoverySlot {
  return value === 'b' ? 'b' : 'a';
}

function parseStatus(value: unknown): RecoveryContactStatus {
  if (value === 'accepted' || value === 'declined' || value === 'pending') {
    return value;
  }
  return 'pending';
}

export function eligibleRecoveryMembers(
  members: { userId: string; role: SpaceRole }[],
  approvedUserIds: Set<string>,
  pickerUserId: string,
): { userId: string; role: SpaceRole }[] {
  return members.filter(
    (row) =>
      row.userId !== pickerUserId &&
      isRecoveryContactRole(row.role) &&
      approvedUserIds.has(row.userId),
  );
}

export const supabaseRecoveryAccessGateway: RecoveryAccessGateway = {
  async fetchMeta(spaceId) {
    const { data, error } = await supabase
      .from('family_key_meta')
      .select('key_epoch, recovery_key_epoch')
      .eq('family_space_id', spaceId)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_recovery_meta', error.code ?? 'unknown');
      throw error;
    }
    if (!data) {
      return null;
    }
    return {
      keyEpoch: data.key_epoch as number,
      recoveryKeyEpoch: data.recovery_key_epoch as number,
    };
  },

  async fetchOwnRecoveryPublic(spaceId, userId) {
    const { data, error } = await supabase
      .from('recovery_public_keys')
      .select('public_key, recovery_key_epoch')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_recovery_public', error.code ?? 'unknown');
      throw error;
    }
    if (!data) {
      return null;
    }
    return {
      publicKey: requireX25519PublicKey(fromPgBytea(data.public_key)),
      recoveryKeyEpoch: data.recovery_key_epoch as number,
    };
  },

  async listContacts(spaceId) {
    const { data, error } = await supabase
      .from('recovery_contacts')
      .select('id, member_id, user_id, slot, status')
      .eq('family_space_id', spaceId);
    if (error) {
      logKeyStep('list_recovery_contacts', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      spaceId,
      memberId: row.member_id as string,
      userId: row.user_id as string,
      slot: parseSlot(row.slot),
      status: parseStatus(row.status),
    }));
  },

  async inviteContact(input) {
    const { error } = await supabase.from('recovery_contacts').insert({
      family_space_id: input.spaceId,
      member_id: input.memberId,
      user_id: input.userId,
      slot: input.slot,
      created_by: input.createdBy,
      status: 'pending',
    });
    if (error) {
      logKeyStep('invite_recovery_contact', error.code ?? 'unknown');
      throw error;
    }
  },

  async setContactStatus(spaceId, userId, status) {
    const { error } = await supabase
      .from('recovery_contacts')
      .update({ status })
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (error) {
      logKeyStep('set_recovery_contact_status', error.code ?? 'unknown');
      throw error;
    }
  },

  async deleteContact(spaceId, userId) {
    const { error } = await supabase
      .from('recovery_contacts')
      .delete()
      .eq('family_space_id', spaceId)
      .eq('user_id', userId);
    if (error) {
      logKeyStep('delete_recovery_contact', error.code ?? 'unknown');
      throw error;
    }
  },

  async listApprovedDevices(spaceId, userId) {
    const { data, error } = await supabase.rpc('approved_devices_for_member', {
      p_space_id: spaceId,
      p_user_id: userId,
    });
    if (error) {
      logKeyStep('list_approved_devices', error.code ?? 'unknown');
      throw error;
    }
    const rows = (data ?? []) as { device_id: string; public_key: unknown }[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      publicKey: requireX25519PublicKey(fromPgBytea(row.public_key)),
    }));
  },

  async listRecoveryContactPublicKeys(spaceId, contactUserId) {
    const { data, error } = await supabase.rpc('recovery_contact_public_keys', {
      p_space_id: spaceId,
      p_contact_user_id: contactUserId,
    });
    if (error) {
      logKeyStep('list_recovery_contact_public_keys', error.code ?? 'unknown');
      throw error;
    }
    const rows = (data ?? []) as { device_id: string; public_key: unknown }[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      publicKey: requireX25519PublicKey(fromPgBytea(row.public_key)),
    }));
  },

  async listEligibleRecoveryContacts(spaceId) {
    const { data, error } = await supabase.rpc('eligible_recovery_contacts', {
      p_space_id: spaceId,
    });
    if (error) {
      logKeyStep('list_eligible_recovery_contacts', error.code ?? 'unknown');
      throw error;
    }
    const rows = (data ?? []) as { user_id: string; display_name: string }[];
    return rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
    }));
  },

  async upsertFamilyKeyUnderRecovery(input) {
    const { error } = await supabase.rpc('upsert_family_key_under_recovery', {
      p_space_id: input.spaceId,
      p_user_id: input.userId,
      p_key_epoch: input.keyEpoch,
      p_wrapped_family_key: toPgBytea(input.wrappedFamilyKey),
    });
    if (error) {
      logKeyStep('upsert_family_key_under_recovery', error.code ?? 'unknown');
      throw error;
    }
  },

  async insertRecoveryPublicKey(input) {
    const { error } = await supabase.rpc('replace_recovery_public_key', {
      p_space_id: input.spaceId,
      p_public_key: toPgBytea(input.publicKey),
      p_recovery_key_epoch: input.recoveryKeyEpoch,
      p_personal_seal: input.personalSeal ? toPgBytea(input.personalSeal) : null,
    });
    if (error) {
      logKeyStep('replace_recovery_public_key', error.code ?? 'unknown');
      throw error;
    }
  },

  async insertHolderSecret(input) {
    const { error } = await supabase.from('recovery_contact_secrets').insert({
      family_space_id: input.spaceId,
      member_id: input.memberId,
      user_id: input.userId,
      device_id: input.deviceId,
      wrapped_secret: toPgBytea(input.wrappedSecret),
      recovery_key_epoch: input.recoveryKeyEpoch,
    });
    if (error) {
      logKeyStep('insert_holder_secret', error.code ?? 'unknown');
      throw error;
    }
  },

  async insertPairWrap(input) {
    const { error } = await supabase.from('recovery_pair_wraps').insert({
      family_space_id: input.spaceId,
      user_id: input.userId,
      recovery_key_epoch: input.recoveryKeyEpoch,
      pair_id: input.pairId,
      wrapped_recovery_key: toPgBytea(input.wrappedRecoveryKey),
    });
    if (error) {
      logKeyStep('insert_pair_wrap', error.code ?? 'unknown');
      throw error;
    }
  },

  async listPairIds(spaceId, userId, recoveryKeyEpoch) {
    const rows = await this.fetchPairWraps(spaceId, userId, recoveryKeyEpoch);
    return rows.map((row) => row.pairId);
  },

  async fetchPairWraps(spaceId, userId, recoveryKeyEpoch) {
    const { data, error } = await supabase
      .from('recovery_pair_wraps')
      .select('pair_id, wrapped_recovery_key')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .eq('recovery_key_epoch', recoveryKeyEpoch);
    if (error) {
      logKeyStep('list_pair_ids', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      pairId: row.pair_id as string,
      wrappedRecoveryKey: fromPgBytea(row.wrapped_recovery_key),
    }));
  },

  async purgeCiphertext(spaceId) {
    const { error } = await supabase.rpc('purge_member_recovery', {
      p_space_id: spaceId,
    });
    if (error) {
      logKeyStep('purge_member_recovery', error.code ?? 'unknown');
      throw error;
    }
  },
};
