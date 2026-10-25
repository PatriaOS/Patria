// SECURITY REVIEW REQUIRED
import { logKeyStep } from '../devLog';
import { supabase } from '../supabase';
import { concatBytes, encodeUtf8Prefixed, utf8ToBytes, wipe } from './bytes';
import { ensureDeviceIdentity } from './deviceIdentity';
import {
  cachePersonalKey,
  loadCachedPersonalKey,
  personalKeyNeedsOtherPhone,
} from './keyStore';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';
import { randomKey32 } from './random';
import { unwrapSecretWithAad, wrapSecretWithAad } from './wrap';

const DEVICE_CONTEXT = utf8ToBytes('patria/personal-key/v1');
const RECOVERY_CONTEXT = utf8ToBytes('patria/personal-key-recovery/v1');

export type PersonalDeviceAad = {
  familySpaceId: string;
  userId: string;
  deviceId: string;
};

export function encodePersonalDeviceAad(aad: PersonalDeviceAad): Uint8Array {
  return concatBytes(
    DEVICE_CONTEXT,
    encodeUtf8Prefixed(aad.familySpaceId),
    encodeUtf8Prefixed(aad.userId),
    encodeUtf8Prefixed(aad.deviceId),
  );
}

export function encodePersonalRecoveryAad(familySpaceId: string, userId: string): Uint8Array {
  return concatBytes(RECOVERY_CONTEXT, encodeUtf8Prefixed(familySpaceId), encodeUtf8Prefixed(userId));
}

export function wrapPersonalKeyToDevice(
  personalKey: Uint8Array,
  devicePublicKey: Uint8Array,
  aad: PersonalDeviceAad,
): Uint8Array {
  return wrapSecretWithAad(personalKey, devicePublicKey, encodePersonalDeviceAad(aad));
}

export function unwrapPersonalKeyFromDevice(
  wrapped: Uint8Array,
  devicePrivateKey: Uint8Array,
  aad: PersonalDeviceAad,
): Uint8Array {
  return unwrapSecretWithAad(wrapped, devicePrivateKey, encodePersonalDeviceAad(aad));
}

export function wrapPersonalKeyToRecovery(
  personalKey: Uint8Array,
  recoveryPublicKey: Uint8Array,
  familySpaceId: string,
  userId: string,
): Uint8Array {
  return wrapSecretWithAad(
    personalKey,
    recoveryPublicKey,
    encodePersonalRecoveryAad(familySpaceId, userId),
  );
}

export function unwrapPersonalKeyFromRecovery(
  wrapped: Uint8Array,
  recoveryPrivateKey: Uint8Array,
  familySpaceId: string,
  userId: string,
): Uint8Array {
  return unwrapSecretWithAad(
    wrapped,
    recoveryPrivateKey,
    encodePersonalRecoveryAad(familySpaceId, userId),
  );
}

export type ApprovedPersonalDevice = {
  deviceId: string;
  publicKey: Uint8Array;
};

export async function listApprovedPersonalDevices(
  spaceId: string,
  userId: string,
): Promise<ApprovedPersonalDevice[]> {
  const { data, error } = await supabase.rpc('approved_personal_devices', {
    _space_id: spaceId,
    _user_id: userId,
  });
  if (error) {
    logKeyStep('list_approved_personal_devices', error.code ?? 'unknown');
    throw error;
  }
  const ids = ((data ?? []) as { device_id: string }[]).map((row) => row.device_id);
  if (ids.length === 0) {
    return [];
  }
  const { data: keys, error: keysError } = await supabase
    .from('device_keys')
    .select('device_id, public_key')
    .eq('user_id', userId)
    .in('device_id', ids);
  if (keysError) {
    logKeyStep('list_approved_personal_device_keys', keysError.code ?? 'unknown');
    throw keysError;
  }
  return ((keys ?? []) as { device_id: string; public_key: unknown }[]).map((row) => ({
    deviceId: row.device_id,
    publicKey: requireX25519PublicKey(fromPgBytea(row.public_key)),
  }));
}

async function fetchOwnPersonalWrap(
  spaceId: string,
  userId: string,
  deviceId: string,
): Promise<Uint8Array | null> {
  const { data, error } = await supabase
    .from('personal_key_wraps')
    .select('wrapped_key')
    .eq('family_space_id', spaceId)
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) {
    logKeyStep('fetch_own_personal_wrap', error.code ?? 'unknown');
    throw error;
  }
  return data ? fromPgBytea(data.wrapped_key) : null;
}

async function personalKeyExists(spaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('personal_key_under_recovery')
    .select('user_id')
    .eq('family_space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logKeyStep('personal_key_exists', error.code ?? 'unknown');
    throw error;
  }
  return Boolean(data);
}

export async function loadPersonalKeyIfPresent(input: {
  spaceId: string;
  userId: string;
}): Promise<Uint8Array | null> {
  const cached = await loadCachedPersonalKey(input.userId, input.spaceId);
  if (cached) {
    return cached;
  }
  if (!(await personalKeyExists(input.spaceId, input.userId))) {
    return null;
  }
  const device = await ensureDeviceIdentity(input.userId);
  const wrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
  if (!wrap) {
    throw new Error(personalKeyNeedsOtherPhone);
  }
  const opened = unwrapPersonalKeyFromDevice(wrap, device.privateKey, {
    familySpaceId: input.spaceId,
    userId: input.userId,
    deviceId: device.deviceId,
  });
  await cachePersonalKey(input.userId, input.spaceId, opened);
  return opened;
}

export async function obtainPersonalKey(input: {
  spaceId: string;
  userId: string;
}): Promise<Uint8Array> {
  const existing = await loadPersonalKeyIfPresent(input);
  if (existing) {
    return existing;
  }
  const device = await ensureDeviceIdentity(input.userId);
  const targets = await listApprovedPersonalDevices(input.spaceId, input.userId);
  if (targets.length === 0) {
    throw new Error('missing family key');
  }
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_public_keys')
    .select('public_key')
    .eq('family_space_id', input.spaceId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (recoveryError || !recovery) {
    logKeyStep('fetch_recovery_public_for_personal', recoveryError?.code ?? 'missing');
    throw recoveryError ?? new Error('missing recovery public key');
  }
  const personalKey = randomKey32();
  try {
    const wrappedKeys = targets.map((row) =>
      wrapPersonalKeyToDevice(personalKey, row.publicKey, {
        familySpaceId: input.spaceId,
        userId: input.userId,
        deviceId: row.deviceId,
      }),
    );
    const sealed = wrapPersonalKeyToRecovery(
      personalKey,
      requireX25519PublicKey(fromPgBytea(recovery.public_key)),
      input.spaceId,
      input.userId,
    );
    const { error } = await supabase.rpc('create_personal_key', {
      p_space_id: input.spaceId,
      p_device_ids: targets.map((row) => row.deviceId),
      p_wrapped_keys: wrappedKeys.map((row) => toPgBytea(row)),
      p_sealed_key: toPgBytea(sealed),
    });
    if (error) {
      const wrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
      if (!wrap) {
        if (await personalKeyExists(input.spaceId, input.userId)) {
          throw new Error(personalKeyNeedsOtherPhone);
        }
        logKeyStep('create_personal_key', error.code ?? 'unknown');
        throw error;
      }
      wipe(personalKey);
      const opened = unwrapPersonalKeyFromDevice(wrap, device.privateKey, {
        familySpaceId: input.spaceId,
        userId: input.userId,
        deviceId: device.deviceId,
      });
      await cachePersonalKey(input.userId, input.spaceId, opened);
      return opened;
    }
    await cachePersonalKey(input.userId, input.spaceId, personalKey);
    return personalKey;
  } catch (error) {
    wipe(personalKey);
    throw error;
  }
}

export async function wrapPersonalKeyForApprovedDeviceIfPresent(input: {
  spaceId: string;
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
}): Promise<void> {
  if (!(await personalKeyExists(input.spaceId, input.userId))) {
    return;
  }
  await wrapPersonalKeyForApprovedDevice(input);
}

export async function wrapPersonalKeyForApprovedDevice(input: {
  spaceId: string;
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
}): Promise<void> {
  const personalKey = await obtainPersonalKey({ spaceId: input.spaceId, userId: input.userId });
  try {
    const wrapped = wrapPersonalKeyToDevice(personalKey, input.publicKey, {
      familySpaceId: input.spaceId,
      userId: input.userId,
      deviceId: input.deviceId,
    });
    const { error } = await supabase.from('personal_key_wraps').insert({
      family_space_id: input.spaceId,
      user_id: input.userId,
      device_id: input.deviceId,
      wrapped_key: toPgBytea(wrapped),
    });
    if (error && error.code !== '23505') {
      logKeyStep('insert_personal_key_wrap', error.code ?? 'unknown');
      throw error;
    }
  } finally {
    wipe(personalKey);
  }
}

export async function restorePersonalKeyFromRecovery(input: {
  spaceId: string;
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
  recoveryPrivateKey: Uint8Array;
}): Promise<void> {
  const { data, error } = await supabase
    .from('personal_key_under_recovery')
    .select('wrapped_key')
    .eq('family_space_id', input.spaceId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) {
    logKeyStep('fetch_personal_recovery_seal', error.code ?? 'unknown');
    throw error;
  }
  if (!data) {
    return;
  }
  const personalKey = unwrapPersonalKeyFromRecovery(
    fromPgBytea(data.wrapped_key),
    input.recoveryPrivateKey,
    input.spaceId,
    input.userId,
  );
  try {
    await cachePersonalKey(input.userId, input.spaceId, personalKey);
    const wrapped = wrapPersonalKeyToDevice(personalKey, input.publicKey, {
      familySpaceId: input.spaceId,
      userId: input.userId,
      deviceId: input.deviceId,
    });
    const { error: insertError } = await supabase.from('personal_key_wraps').insert({
      family_space_id: input.spaceId,
      user_id: input.userId,
      device_id: input.deviceId,
      wrapped_key: toPgBytea(wrapped),
    });
    if (insertError && insertError.code !== '23505') {
      logKeyStep('restore_personal_key_wrap', insertError.code ?? 'unknown');
      throw insertError;
    }
  } finally {
    wipe(personalKey);
  }
}

export async function personalSealForRecoveryChange(input: {
  spaceId: string;
  userId: string;
  recoveryPublicKey: Uint8Array;
}): Promise<Uint8Array | null> {
  if (!(await personalKeyExists(input.spaceId, input.userId))) {
    return null;
  }
  const personalKey = await obtainPersonalKey({ spaceId: input.spaceId, userId: input.userId });
  try {
    return wrapPersonalKeyToRecovery(
      personalKey,
      input.recoveryPublicKey,
      input.spaceId,
      input.userId,
    );
  } finally {
    wipe(personalKey);
  }
}

export { personalKeyNeedsOtherPhone };
