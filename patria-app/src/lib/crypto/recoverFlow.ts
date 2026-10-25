// SECURITY REVIEW REQUIRED
import { logKeyStep } from '../devLog';
import { supabase } from '../supabase';
import { concatBytes, encodeUtf8Prefixed, wipe } from './bytes';
import { cacheFamilySecrets } from './keyStore';
import { restorePersonalKeyFromRecovery } from './personalKey';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';
import { decodePrintedCode } from './printedCode';
import {
  openWithHolders,
  type RecoveryBoxes,
  type RecoveryContext,
} from './recovery';
import {
  unwrapFamilyKeyFromRecoveryPrivate,
  unwrapKeyFromDevice,
  unwrapSecretWithAad,
  wrapKeyToDevice,
  wrapSecretWithAad,
} from './wrap';

export type RecoveryRequestRow = {
  id: string;
  spaceId: string;
  userId: string;
  newDeviceId: string;
  newDeviceCreatedAt: string | null;
  startedAt: string;
  notBefore: string;
  expiresAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  completedAt: string | null;
};

export type HelperSlot = 'a' | 'b';

export type HolderSecretRow = {
  wrappedSecret: Uint8Array;
  recoveryKeyEpoch: number;
  deviceId: string;
};

export type RecoverFlowGateway = {
  startRequest(spaceId: string, deviceId: string, publicKey: Uint8Array): Promise<string>;
  listRequests(spaceId: string): Promise<RecoveryRequestRow[]>;
  cancelRequest(requestId: string): Promise<void>;
  fetchDevicePublicKey(requestId: string): Promise<Uint8Array>;
  fetchOwnHolderSecret(
    spaceId: string,
    userId: string,
    deviceId: string,
  ): Promise<HolderSecretRow | null>;
  approveHelper(requestId: string, slot: HelperSlot, wrappedSecret: Uint8Array): Promise<void>;
  listHelpers(requestId: string): Promise<{ slot: HelperSlot; wrappedSecret: Uint8Array }[]>;
  fetchPairBoxes(
    spaceId: string,
    userId: string,
    recoveryKeyEpoch: number,
  ): Promise<RecoveryBoxes | null>;
  fetchSealedFamilyKeys(
    spaceId: string,
    userId: string,
  ): Promise<{ keyEpoch: number; sealed: Uint8Array }[]>;
  fetchMeta(
    spaceId: string,
  ): Promise<{ keyEpoch: number; recoveryKeyEpoch: number } | null>;
  fetchRecoveryEpoch(spaceId: string, userId: string): Promise<number | null>;
  insertFamilyWrap(input: {
    spaceId: string;
    userId: string;
    deviceId: string;
    wrappedKey: Uint8Array;
    keyEpoch: number;
    approvedBy: string;
  }): Promise<void>;
  completeRequest(requestId: string): Promise<void>;
  listRemovedNotices(
    spaceId: string,
  ): Promise<{ id: string; userId: string; deviceId: string }[]>;
};

export function encodeHelperRewrapAad(input: {
  familySpaceId: string;
  requestId: string;
  userId: string;
  deviceId: string;
}): Uint8Array {
  return concatBytes(
    encodeUtf8Prefixed(input.familySpaceId),
    encodeUtf8Prefixed(input.requestId),
    encodeUtf8Prefixed(input.userId),
    encodeUtf8Prefixed(input.deviceId),
  );
}

export function cancelledCopyKind(
  cancelledBy: string | null,
  requesterUserId: string,
): 'you' | 'admin' {
  if (cancelledBy === requesterUserId) {
    return 'you';
  }
  return 'admin';
}

export function requestIsWaiting(request: RecoveryRequestRow, now = Date.now()): boolean {
  return (
    request.cancelledAt == null &&
    request.completedAt == null &&
    now < Date.parse(request.notBefore)
  );
}

export function requestCanFinish(request: RecoveryRequestRow, now = Date.now()): boolean {
  return (
    request.cancelledAt == null &&
    request.completedAt == null &&
    now >= Date.parse(request.notBefore) &&
    now < Date.parse(request.expiresAt)
  );
}

export function reconstructRecoveryKey(
  boxes: RecoveryBoxes,
  holders: { a?: Uint8Array; b?: Uint8Array; p?: Uint8Array },
  ctx: RecoveryContext,
): Uint8Array {
  const present: { id: 'a' | 'b' | 'p'; secret: Uint8Array }[] = [];
  if (holders.a) {
    present.push({ id: 'a', secret: holders.a });
  }
  if (holders.b) {
    present.push({ id: 'b', secret: holders.b });
  }
  if (holders.p) {
    present.push({ id: 'p', secret: holders.p });
  }
  if (present.length !== 2) {
    throw new Error('unwrap failed');
  }
  return openWithHolders(boxes, present[0], present[1], ctx);
}

export function parsePrintedHelper(words: string): Uint8Array {
  return decodePrintedCode(words);
}

function parseSlot(value: unknown): HelperSlot {
  return value === 'b' ? 'b' : 'a';
}

function mapRequest(row: {
  id: unknown;
  family_space_id: unknown;
  user_id: unknown;
  new_device_id: unknown;
  started_at: unknown;
  not_before: unknown;
  expires_at: unknown;
  cancelled_at: unknown;
  cancelled_by: unknown;
  completed_at: unknown;
}): RecoveryRequestRow {
  return {
    id: row.id as string,
    spaceId: row.family_space_id as string,
    userId: row.user_id as string,
    newDeviceId: row.new_device_id as string,
    startedAt: row.started_at as string,
    notBefore: row.not_before as string,
    expiresAt: row.expires_at as string,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancelledBy: (row.cancelled_by as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    newDeviceCreatedAt: null,
  };
}

export const supabaseRecoverFlowGateway: RecoverFlowGateway = {
  async startRequest(spaceId, deviceId, publicKey) {
    const { data, error } = await supabase.rpc('start_recovery_request', {
      p_space_id: spaceId,
      p_device_id: deviceId,
      p_public_key: toPgBytea(publicKey),
    });
    if (error) {
      logKeyStep('start_recovery_request', error.code ?? 'unknown');
      throw error;
    }
    return data as string;
  },

  async listRequests(spaceId) {
    const { data, error } = await supabase
      .from('recovery_requests')
      .select(
        'id, family_space_id, user_id, new_device_id, started_at, not_before, expires_at, cancelled_at, cancelled_by, completed_at',
      )
      .eq('family_space_id', spaceId)
      .order('started_at', { ascending: false });
    if (error) {
      logKeyStep('list_recovery_requests', error.code ?? 'unknown');
      throw error;
    }
    const mapped = (data ?? []).map(mapRequest);
    if (mapped.length === 0) {
      return mapped;
    }
    const { data: keys, error: keysError } = await supabase
      .from('device_keys')
      .select('user_id, device_id, created_at');
    if (keysError) {
      logKeyStep('list_recovery_request_devices', keysError.code ?? 'unknown');
      throw keysError;
    }
    const created = new Map(
      (keys ?? []).map((row) => [
        `${row.user_id as string}:${row.device_id as string}`,
        row.created_at as string,
      ]),
    );
    return mapped.map((row) => ({
      ...row,
      newDeviceCreatedAt: created.get(`${row.userId}:${row.newDeviceId}`) ?? null,
    }));
  },

  async cancelRequest(requestId) {
    const { error } = await supabase.rpc('cancel_recovery_request', {
      p_request_id: requestId,
    });
    if (error) {
      logKeyStep('cancel_recovery_request', error.code ?? 'unknown');
      throw error;
    }
  },

  async fetchDevicePublicKey(requestId) {
    const { data, error } = await supabase.rpc('recovery_request_device_public_key', {
      p_request_id: requestId,
    });
    if (error) {
      logKeyStep('fetch_recovery_device_key', error.code ?? 'unknown');
      throw error;
    }
    const rows = (data ?? []) as { device_id: string; public_key: unknown }[];
    const row = rows[0];
    if (!row) {
      throw new Error('unwrap failed');
    }
    return requireX25519PublicKey(fromPgBytea(row.public_key));
  },

  async fetchOwnHolderSecret(spaceId, userId, deviceId) {
    const { data, error } = await supabase
      .from('recovery_contact_secrets')
      .select('wrapped_secret, recovery_key_epoch, device_id')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_holder_secret', error.code ?? 'unknown');
      throw error;
    }
    if (!data) {
      return null;
    }
    return {
      wrappedSecret: fromPgBytea(data.wrapped_secret),
      recoveryKeyEpoch: data.recovery_key_epoch as number,
      deviceId: data.device_id as string,
    };
  },

  async approveHelper(requestId, slot, wrappedSecret) {
    const { error } = await supabase.rpc('approve_recovery_helper', {
      p_request_id: requestId,
      p_slot: slot,
      p_wrapped_secret: toPgBytea(wrappedSecret),
    });
    if (error) {
      logKeyStep('approve_recovery_helper', error.code ?? 'unknown');
      throw error;
    }
  },

  async listHelpers(requestId) {
    const { data, error } = await supabase
      .from('recovery_request_helpers')
      .select('slot, wrapped_secret')
      .eq('request_id', requestId);
    if (error) {
      logKeyStep('list_recovery_helpers', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      slot: parseSlot(row.slot),
      wrappedSecret: fromPgBytea(row.wrapped_secret),
    }));
  },

  async fetchPairBoxes(spaceId, userId, recoveryKeyEpoch) {
    const { data, error } = await supabase
      .from('recovery_pair_wraps')
      .select('pair_id, wrapped_recovery_key')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .eq('recovery_key_epoch', recoveryKeyEpoch);
    if (error) {
      logKeyStep('fetch_pair_boxes', error.code ?? 'unknown');
      throw error;
    }
    const rows = data ?? [];
    const ab = rows.find((row) => row.pair_id === 'ab');
    const ap = rows.find((row) => row.pair_id === 'ap');
    const bp = rows.find((row) => row.pair_id === 'bp');
    if (!ab || !ap || !bp) {
      return null;
    }
    return {
      boxAb: fromPgBytea(ab.wrapped_recovery_key),
      boxAp: fromPgBytea(ap.wrapped_recovery_key),
      boxBp: fromPgBytea(bp.wrapped_recovery_key),
    };
  },

  async fetchSealedFamilyKeys(spaceId, userId) {
    const { data, error } = await supabase
      .from('family_key_under_recovery')
      .select('key_epoch, wrapped_family_key')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .order('key_epoch', { ascending: false });
    if (error) {
      logKeyStep('fetch_sealed_family_keys', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      keyEpoch: row.key_epoch as number,
      sealed: fromPgBytea(row.wrapped_family_key),
    }));
  },

  async fetchMeta(spaceId) {
    const { data, error } = await supabase
      .from('family_key_meta')
      .select('key_epoch, recovery_key_epoch')
      .eq('family_space_id', spaceId)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_recover_meta', error.code ?? 'unknown');
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

  async fetchRecoveryEpoch(spaceId, userId) {
    const { data, error } = await supabase
      .from('recovery_public_keys')
      .select('recovery_key_epoch')
      .eq('family_space_id', spaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      logKeyStep('fetch_recovery_epoch', error.code ?? 'unknown');
      throw error;
    }
    if (!data) {
      return null;
    }
    return data.recovery_key_epoch as number;
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
      logKeyStep('insert_recovered_family_wrap', error.code ?? 'unknown');
      throw error;
    }
  },

  async completeRequest(requestId) {
    const { error } = await supabase.rpc('complete_recovery_request', {
      p_request_id: requestId,
    });
    if (error) {
      logKeyStep('complete_recovery_request', error.code ?? 'unknown');
      throw error;
    }
  },

  async listRemovedNotices(spaceId) {
    const { data, error } = await supabase
      .from('device_removed_notices')
      .select('id, user_id, device_id')
      .eq('family_space_id', spaceId)
      .order('created_at', { ascending: false });
    if (error) {
      logKeyStep('list_removed_notices', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      deviceId: row.device_id as string,
    }));
  },
};

export async function startLostPhoneRecovery(
  input: { spaceId: string; deviceId: string; publicKey: Uint8Array },
  gateway: RecoverFlowGateway = supabaseRecoverFlowGateway,
): Promise<string> {
  return gateway.startRequest(input.spaceId, input.deviceId, input.publicKey);
}

export async function cancelRecoveryRequest(
  requestId: string,
  gateway: RecoverFlowGateway = supabaseRecoverFlowGateway,
): Promise<void> {
  await gateway.cancelRequest(requestId);
}

export async function approveRecoveryAsContact(
  input: {
    spaceId: string;
    request: RecoveryRequestRow;
    slot: HelperSlot;
    contactUserId: string;
    contactDeviceId: string;
    contactPrivateKey: Uint8Array;
  },
  gateway: RecoverFlowGateway = supabaseRecoverFlowGateway,
): Promise<void> {
  if (!requestCanFinish(input.request)) {
    throw new Error('Not allowed');
  }
  const own = await gateway.fetchOwnHolderSecret(
    input.spaceId,
    input.contactUserId,
    input.contactDeviceId,
  );
  if (!own) {
    throw new Error('unwrap failed');
  }
  const holder = unwrapKeyFromDevice(own.wrappedSecret, input.contactPrivateKey, {
    familySpaceId: input.spaceId,
    keyEpoch: own.recoveryKeyEpoch,
    userId: input.contactUserId,
    deviceId: input.contactDeviceId,
  });
  try {
    const newPublic = await gateway.fetchDevicePublicKey(input.request.id);
    const aad = encodeHelperRewrapAad({
      familySpaceId: input.spaceId,
      requestId: input.request.id,
      userId: input.request.userId,
      deviceId: input.request.newDeviceId,
    });
    const wrapped = wrapSecretWithAad(holder, newPublic, aad);
    await gateway.approveHelper(input.request.id, input.slot, wrapped);
  } finally {
    wipe(holder);
  }
}

export async function finishLostPhoneRecovery(
  input: {
    spaceId: string;
    userId: string;
    role: string | null | undefined;
    deviceId: string;
    privateKey: Uint8Array;
    publicKey: Uint8Array;
    request: RecoveryRequestRow;
    paperWords: string;
  },
  gateway: RecoverFlowGateway = supabaseRecoverFlowGateway,
): Promise<void> {
  if (!requestCanFinish(input.request)) {
    throw new Error('Not allowed');
  }
  const meta = await gateway.fetchMeta(input.spaceId);
  if (!meta) {
    throw new Error('unwrap failed');
  }
  const recoveryKeyEpoch =
    (await gateway.fetchRecoveryEpoch(input.spaceId, input.userId)) ?? meta.recoveryKeyEpoch;
  const boxes = await gateway.fetchPairBoxes(input.spaceId, input.userId, recoveryKeyEpoch);
  if (!boxes) {
    throw new Error('unwrap failed');
  }
  const helpers = await gateway.listHelpers(input.request.id);
  const aad = encodeHelperRewrapAad({
    familySpaceId: input.spaceId,
    requestId: input.request.id,
    userId: input.userId,
    deviceId: input.deviceId,
  });
  const holders: { a?: Uint8Array; b?: Uint8Array; p?: Uint8Array } = {};
  const opened: Uint8Array[] = [];
  try {
    const trimmed = input.paperWords.trim();
    if (trimmed.length > 0) {
      holders.p = parsePrintedHelper(trimmed);
      opened.push(holders.p);
    }
    for (const helper of helpers) {
      const secret = unwrapSecretWithAad(helper.wrappedSecret, input.privateKey, aad);
      opened.push(secret);
      holders[helper.slot] = secret;
    }
    const recoveryPrivate = reconstructRecoveryKey(boxes, holders, {
      familySpaceId: input.spaceId,
      userId: input.userId,
      recoveryKeyEpoch,
    });
    opened.push(recoveryPrivate);
    const sealed = await gateway.fetchSealedFamilyKeys(input.spaceId, input.userId);
    let familyKey: Uint8Array | undefined;
    let keyEpoch = meta.keyEpoch;
    for (const row of sealed) {
      try {
        familyKey = unwrapFamilyKeyFromRecoveryPrivate(row.sealed, recoveryPrivate, {
          familySpaceId: input.spaceId,
          keyEpoch: row.keyEpoch,
          userId: input.userId,
        });
        keyEpoch = row.keyEpoch;
        break;
      } catch {
        // Try an older epoch if this box does not open.
      }
    }
    if (!familyKey) {
      throw new Error('unwrap failed');
    }
    opened.push(familyKey);
    const memberAad = {
      familySpaceId: input.spaceId,
      keyEpoch,
      userId: input.userId,
      deviceId: input.deviceId,
    };
    await gateway.insertFamilyWrap({
      spaceId: input.spaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      wrappedKey: wrapKeyToDevice(familyKey, input.publicKey, memberAad),
      keyEpoch,
      approvedBy: input.userId,
    });
    await cacheFamilySecrets(input.userId, input.spaceId, familyKey);
    await restorePersonalKeyFromRecovery({
      spaceId: input.spaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      publicKey: input.publicKey,
      recoveryPrivateKey: recoveryPrivate,
    });
    await gateway.completeRequest(input.request.id);
  } finally {
    for (const secret of opened) {
      wipe(secret);
    }
  }
}
