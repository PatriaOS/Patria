// SECURITY REVIEW REQUIRED
import { logKeyStep } from '../devLog';
import { isKeyEligibleRole } from '../roles';
import { supabase } from '../supabase';
import { wipe } from './bytes';
import type { DeviceIdentity } from './deviceIdentity';
import { obtainFamilyKey } from './keyStore';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';
import { wrapPersonalKeyForApprovedDeviceIfPresent } from './personalKey';
import { wrapKeyToDevice, type MemberWrapAad } from './wrap';

export type DeviceNoticeKind = 'first_device' | 'extra_device' | 'rejected_device';

export type FirstDeviceNotice = {
  id: string;
  spaceId: string;
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
  deviceCreatedAt: string;
  kind: DeviceNoticeKind;
};

export type OwnPhone = {
  deviceId: string;
  createdAt: string;
  rejectedAt: string | null;
  hasWrap: boolean;
};

export type DeviceAccessGateway = {
  upsertDevicePublicKey(
    userId: string,
    deviceId: string,
    publicKey: Uint8Array,
  ): Promise<void>;
  countOwnWraps(spaceId: string, userId: string): Promise<number>;
  insertNotice(spaceId: string, userId: string, deviceId: string): Promise<void>;
  listNotices(spaceId: string): Promise<FirstDeviceNotice[]>;
  fetchOwnWrap(
    spaceId: string,
    userId: string,
    deviceId: string,
  ): Promise<{ wrappedKey: Uint8Array; keyEpoch: number } | null>;
  insertFamilyWrap(input: {
    spaceId: string;
    userId: string;
    deviceId: string;
    wrappedKey: Uint8Array;
    keyEpoch: number;
    approvedBy: string;
  }): Promise<void>;
  insertRecoveryWrap(input: {
    spaceId: string;
    userId: string;
    deviceId: string;
    wrappedKey: Uint8Array;
    approvedBy: string;
  }): Promise<void>;
  deleteNotice(noticeId: string): Promise<void>;
  rejectPendingDevice(spaceId: string, deviceId: string): Promise<void>;
  removeOwnDevice(spaceId: string, deviceId: string): Promise<void>;
  listOwnPhones(spaceId: string, userId: string): Promise<OwnPhone[]>;
};

export function parseNoticeKind(value: unknown): DeviceNoticeKind {
  if (value === 'extra_device' || value === 'rejected_device' || value === 'first_device') {
    return value;
  }
  return 'first_device';
}

export function firstDeviceWrapAad(input: {
  spaceId: string;
  userId: string;
  deviceId: string;
  keyEpoch?: number;
}): MemberWrapAad {
  return {
    familySpaceId: input.spaceId,
    keyEpoch: input.keyEpoch ?? 1,
    userId: input.userId,
    deviceId: input.deviceId,
  };
}

export const extraDeviceWrapAad = firstDeviceWrapAad;

export function assertOwnExtraDevice(callerUserId: string, deviceOwnerUserId: string): void {
  if (callerUserId !== deviceOwnerUserId) {
    throw new Error('extra device wrap is self-only');
  }
}

export function wrapFamilyKeyForFirstDevice(
  familyKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  aad: MemberWrapAad,
): Uint8Array {
  return wrapKeyToDevice(familyKey, recipientPublicKey, aad);
}

export const supabaseDeviceAccessGateway: DeviceAccessGateway = {
  async upsertDevicePublicKey(userId, deviceId, publicKey) {
    const { error } = await supabase.from('device_keys').insert({
      user_id: userId,
      device_id: deviceId,
      public_key: toPgBytea(publicKey),
    });
    if (error && error.code !== '23505') {
      logKeyStep('upsert_device_public_key', error.code ?? 'unknown');
      throw error;
    }
  },

  async countOwnWraps(spaceId, userId) {
    const { data, error } = await supabase
      .from('family_key_wraps')
      .select('device_id')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId);
    if (error) {
      logKeyStep('count_own_wraps', error.code ?? 'unknown');
      throw error;
    }
    return new Set((data ?? []).map((row) => row.device_id as string)).size;
  },

  async insertNotice(spaceId, userId, deviceId) {
    const { error } = await supabase.from('device_approval_notices').insert({
      family_space_id: spaceId,
      user_id: userId,
      device_id: deviceId,
    });
    if (error && error.code !== '23505') {
      logKeyStep('insert_notice', error.code ?? 'unknown');
      throw error;
    }
  },

  async listNotices(spaceId) {
    const { data: notices, error } = await supabase
      .from('device_approval_notices')
      .select('id, user_id, device_id, kind')
      .eq('family_space_id', spaceId);
    if (error) {
      logKeyStep('list_notices', error.code ?? 'unknown');
      throw error;
    }
    const rows = notices ?? [];
    if (rows.length === 0) {
      return [];
    }
    const { data: keys, error: keysError } = await supabase
      .from('device_keys')
      .select('user_id, device_id, public_key, created_at');
    if (keysError) {
      logKeyStep('list_notice_device_keys', keysError.code ?? 'unknown');
      throw keysError;
    }
    const byPair = new Map(
      (keys ?? []).map((row) => [
        `${row.user_id as string}:${row.device_id as string}`,
        row,
      ]),
    );
    return rows.flatMap((notice) => {
      const key = byPair.get(`${notice.user_id as string}:${notice.device_id as string}`);
      if (!key) {
        return [];
      }
      return [
        {
          id: notice.id as string,
          spaceId,
          userId: notice.user_id as string,
          deviceId: notice.device_id as string,
          publicKey: requireX25519PublicKey(fromPgBytea(key.public_key)),
          deviceCreatedAt: key.created_at as string,
          kind: parseNoticeKind(notice.kind),
        },
      ];
    });
  },

  async fetchOwnWrap(spaceId, userId, deviceId) {
    const { data, error } = await supabase
      .from('family_key_wraps')
      .select('wrapped_key, key_epoch')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .order('key_epoch', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_own_wrap', error.code ?? 'unknown');
      throw error;
    }
    if (!data) {
      return null;
    }
    return {
      wrappedKey: fromPgBytea(data.wrapped_key),
      keyEpoch: data.key_epoch as number,
    };
  },

  async insertFamilyWrap(input) {
    const { error } = await supabase.from('family_key_wraps').insert({
      family_space_id: input.spaceId,
      user_id: input.userId,
      device_id: input.deviceId,
      wrapped_key: toPgBytea(input.wrappedKey),
      key_epoch: input.keyEpoch,
      approved_by: input.approvedBy,
    });
    if (error) {
      logKeyStep('insert_family_wrap', error.code ?? 'unknown');
      throw error;
    }
  },

  async insertRecoveryWrap(_input: {
    spaceId: string;
    userId: string;
    deviceId: string;
    wrappedKey: Uint8Array;
    approvedBy: string;
  }) {
    return;
  },

  async deleteNotice(noticeId) {
    const { error } = await supabase.from('device_approval_notices').delete().eq('id', noticeId);
    if (error) {
      logKeyStep('delete_notice', error.code ?? 'unknown');
      throw error;
    }
  },

  async rejectPendingDevice(spaceId, deviceId) {
    const { error } = await supabase.rpc('reject_own_pending_device', {
      p_space_id: spaceId,
      p_device_id: deviceId,
    });
    if (error) {
      logKeyStep('reject_pending_device', error.code ?? 'unknown');
      throw error;
    }
  },

  async removeOwnDevice(spaceId, deviceId) {
    const { error } = await supabase.rpc('remove_own_device', {
      p_space_id: spaceId,
      p_device_id: deviceId,
    });
    if (error) {
      logKeyStep('remove_own_device', error.code ?? 'unknown');
      throw error;
    }
  },

  async listOwnPhones(spaceId, userId) {
    const { data: keys, error: keysError } = await supabase
      .from('device_keys')
      .select('device_id, created_at, rejected_at')
      .eq('user_id', userId);
    if (keysError) {
      logKeyStep('list_own_phones', keysError.code ?? 'unknown');
      throw keysError;
    }
    const { data: wraps, error: wrapsError } = await supabase
      .from('family_key_wraps')
      .select('device_id')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId);
    if (wrapsError) {
      logKeyStep('list_own_phone_wraps', wrapsError.code ?? 'unknown');
      throw wrapsError;
    }
    const withWrap = new Set((wraps ?? []).map((row) => row.device_id as string));
    return (keys ?? []).map((row) => ({
      deviceId: row.device_id as string,
      createdAt: row.created_at as string,
      rejectedAt: (row.rejected_at as string | null) ?? null,
      hasWrap: withWrap.has(row.device_id as string),
    }));
  },
};

export async function requestFirstDeviceAccess(
  input: {
    spaceId: string;
    userId: string;
    role: string | null | undefined;
    device: DeviceIdentity;
  },
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<'notice' | 'skipped'> {
  if (!isKeyEligibleRole(input.role)) {
    return 'skipped';
  }
  await gateway.upsertDevicePublicKey(input.userId, input.device.deviceId, input.device.publicKey);
  const own = await gateway.fetchOwnWrap(input.spaceId, input.userId, input.device.deviceId);
  if (own) {
    return 'skipped';
  }
  await gateway.insertNotice(input.spaceId, input.userId, input.device.deviceId);
  logKeyStep('request_first_device', `${input.spaceId} ${input.device.deviceId}`);
  return 'notice';
}

export async function fetchFirstDeviceNotices(
  spaceId: string,
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<FirstDeviceNotice[]> {
  return gateway.listNotices(spaceId);
}

export async function declineFirstDevice(
  noticeId: string,
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<void> {
  await gateway.deleteNotice(noticeId);
  logKeyStep('decline_first_device', noticeId);
}

export async function approveFirstDevice(
  input: {
    spaceId: string;
    adminUserId: string;
    adminDeviceId: string;
    adminPrivateKey: Uint8Array;
    notice: FirstDeviceNotice;
    memberRole: string | null | undefined;
  },
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<void> {
  if (input.notice.kind !== 'first_device') {
    throw new Error('first-device wrap only');
  }
  const recipientPublicKey = requireX25519PublicKey(fromPgBytea(input.notice.publicKey));
  const familyKey = await obtainFamilyKey({
    userId: input.adminUserId,
    spaceId: input.spaceId,
    deviceId: input.adminDeviceId,
    privateKey: input.adminPrivateKey,
    fetchOwnWrap: gateway.fetchOwnWrap,
  });
  if (!familyKey) {
    throw new Error('missing family key');
  }
  try {
    const ownWrap = await gateway.fetchOwnWrap(
      input.spaceId,
      input.adminUserId,
      input.adminDeviceId,
    );
    const aad = firstDeviceWrapAad({
      spaceId: input.spaceId,
      userId: input.notice.userId,
      deviceId: input.notice.deviceId,
      keyEpoch: ownWrap?.keyEpoch ?? 1,
    });
    const wrapped = wrapFamilyKeyForFirstDevice(familyKey, recipientPublicKey, aad);
    await gateway.insertFamilyWrap({
      spaceId: input.spaceId,
      userId: input.notice.userId,
      deviceId: input.notice.deviceId,
      wrappedKey: wrapped,
      keyEpoch: aad.keyEpoch,
      approvedBy: input.adminUserId,
    });
    await gateway.deleteNotice(input.notice.id);
    logKeyStep('approve_first_device', `${input.spaceId} ${input.notice.deviceId}`);
  } finally {
    wipe(familyKey);
  }
}

export async function approveOwnExtraDevice(
  input: {
    spaceId: string;
    userId: string;
    approverDeviceId: string;
    approverPrivateKey: Uint8Array;
    notice: FirstDeviceNotice;
    role: string | null | undefined;
  },
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<void> {
  assertOwnExtraDevice(input.userId, input.notice.userId);
  if (input.notice.kind !== 'extra_device') {
    throw new Error('extra-device wrap only');
  }
  const recipientPublicKey = requireX25519PublicKey(fromPgBytea(input.notice.publicKey));
  const familyKey = await obtainFamilyKey({
    userId: input.userId,
    spaceId: input.spaceId,
    deviceId: input.approverDeviceId,
    privateKey: input.approverPrivateKey,
    fetchOwnWrap: gateway.fetchOwnWrap,
  });
  if (!familyKey) {
    throw new Error('missing family key');
  }
  try {
    const ownWrap = await gateway.fetchOwnWrap(
      input.spaceId,
      input.userId,
      input.approverDeviceId,
    );
    const aad = extraDeviceWrapAad({
      spaceId: input.spaceId,
      userId: input.notice.userId,
      deviceId: input.notice.deviceId,
      keyEpoch: ownWrap?.keyEpoch ?? 1,
    });
    const wrapped = wrapFamilyKeyForFirstDevice(familyKey, recipientPublicKey, aad);
    await gateway.insertFamilyWrap({
      spaceId: input.spaceId,
      userId: input.notice.userId,
      deviceId: input.notice.deviceId,
      wrappedKey: wrapped,
      keyEpoch: aad.keyEpoch,
      approvedBy: input.userId,
    });
    await wrapPersonalKeyForApprovedDeviceIfPresent({
      spaceId: input.spaceId,
      userId: input.notice.userId,
      deviceId: input.notice.deviceId,
      publicKey: recipientPublicKey,
    });
    await gateway.deleteNotice(input.notice.id);
    logKeyStep('approve_own_extra_device', `${input.spaceId} ${input.notice.deviceId}`);
  } finally {
    wipe(familyKey);
  }
}

export async function rejectOwnExtraDevice(
  input: { spaceId: string; userId: string; notice: FirstDeviceNotice },
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<void> {
  assertOwnExtraDevice(input.userId, input.notice.userId);
  await gateway.rejectPendingDevice(input.spaceId, input.notice.deviceId);
  logKeyStep('reject_own_extra_device', input.notice.deviceId);
}

export async function removeOwnPhone(
  input: { spaceId: string; userId: string; deviceId: string; thisDeviceId: string },
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<void> {
  if (input.deviceId === input.thisDeviceId) {
    throw new Error('cannot remove this phone');
  }
  await gateway.removeOwnDevice(input.spaceId, input.deviceId);
  logKeyStep('remove_own_phone', input.deviceId);
}

export async function listOwnPhones(
  spaceId: string,
  userId: string,
  gateway: DeviceAccessGateway = supabaseDeviceAccessGateway,
): Promise<OwnPhone[]> {
  return gateway.listOwnPhones(spaceId, userId);
}
