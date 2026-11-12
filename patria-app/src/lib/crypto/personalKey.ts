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

/** True when this user already has a personal key (recovery seal and/or any device wrap). */
export async function personalKeyExistsAnywhere(
  spaceId: string,
  userId: string,
): Promise<boolean> {
  if (await personalKeyExists(spaceId, userId)) {
    return true;
  }
  const { count, error } = await supabase
    .from('personal_key_wraps')
    .select('device_id', { count: 'exact', head: true })
    .eq('family_space_id', spaceId)
    .eq('user_id', userId);
  if (error) {
    logKeyStep('personal_key_wraps_exist', error.code ?? 'unknown');
    throw error;
  }
  return (count ?? 0) > 0;
}

function enrollReasonCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0 && code.length <= 32) {
      return code;
    }
  }
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.startsWith(personalKeyNeedsOtherPhone)) {
      return 'needs_other_phone';
    }
    if (msg === 'missing family key') {
      return 'missing_family_key';
    }
    if (msg === 'missing recovery public key') {
      return 'missing_recovery_public';
    }
  }
  return 'enroll_failed';
}

export type PersonalKeyDeviceStatus =
  | 'ready'
  | 'needsOtherPhone'
  | 'needsRecovery'
  | 'enrollError';

export type PersonalKeyEnsureResult = {
  status: PersonalKeyDeviceStatus;
  reasonCode?: string;
};

async function hasRecoveryPublicKey(spaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('recovery_public_keys')
    .select('user_id')
    .eq('family_space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logKeyStep('recovery_public_for_personal', error.code ?? 'unknown');
    throw error;
  }
  return Boolean(data);
}

/**
 * After family keys are ready on this device (let in), finish the personal wrap:
 * enroll from cache if present; create only when no personal key exists anywhere;
 * otherwise needs-other-phone. Never mint a second personal key.
 * Missing recovery is a calm next step, not a red enroll error.
 */
export async function ensurePersonalKeyAfterFamilyReady(input: {
  spaceId: string;
  userId: string;
}): Promise<PersonalKeyEnsureResult> {
  const device = await ensureDeviceIdentity(input.userId);
  if (!(await deviceHasFamilyWrap(input.spaceId, input.userId, device.deviceId))) {
    logKeyStep('ensure_personal_after_family', 'no_family_wrap');
    return { status: 'enrollError', reasonCode: 'no_family_wrap' };
  }

  const ownWrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
  if (ownWrap) {
    return { status: 'ready' };
  }

  const cached = await loadCachedPersonalKey(input.userId, input.spaceId);
  if (cached) {
    try {
      const result = await enrollPersonalWrapFromCacheIfApproved({
        spaceId: input.spaceId,
        userId: input.userId,
        personalKey: cached,
      });
      if (result === 'enrolled' || result === 'already') {
        return { status: 'ready' };
      }
      logKeyStep('ensure_personal_after_family', 'not_approved');
      return { status: 'enrollError', reasonCode: 'not_approved' };
    } catch (error) {
      const reasonCode = enrollReasonCode(error);
      logKeyStep('enroll_personal_wrap_from_cache', reasonCode);
      return { status: 'enrollError', reasonCode };
    }
  }

  if (await personalKeyExistsAnywhere(input.spaceId, input.userId)) {
    logKeyStep('ensure_personal_after_family', 'needs_other_phone');
    return { status: 'needsOtherPhone' };
  }

  if (!(await hasRecoveryPublicKey(input.spaceId, input.userId))) {
    logKeyStep('ensure_personal_after_family', 'needs_recovery');
    return { status: 'needsRecovery', reasonCode: 'missing_recovery_public' };
  }

  try {
    const personalKey = await obtainPersonalKey({
      spaceId: input.spaceId,
      userId: input.userId,
    });
    wipe(personalKey);
    const wrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
    if (!wrap) {
      // Create returned without a wrap for this device — key may already live elsewhere.
      if (await personalKeyExistsAnywhere(input.spaceId, input.userId)) {
        logKeyStep('ensure_personal_after_family', 'needs_other_phone');
        return { status: 'needsOtherPhone' };
      }
      logKeyStep('ensure_personal_after_family', 'create_no_wrap');
      return { status: 'enrollError', reasonCode: 'create_no_wrap' };
    }
    return { status: 'ready' };
  } catch (error) {
    const reasonCode = enrollReasonCode(error);
    if (reasonCode === 'needs_other_phone') {
      logKeyStep('ensure_personal_after_family', reasonCode);
      return { status: 'needsOtherPhone' };
    }
    if (reasonCode === 'missing_recovery_public') {
      logKeyStep('ensure_personal_create', reasonCode);
      return { status: 'needsRecovery', reasonCode };
    }
    // create_personal_key refuses a second key (42501) — never show a generic enroll
    // error when wraps / recovery seal already exist on another device.
    if (await personalKeyExistsAnywhere(input.spaceId, input.userId)) {
      logKeyStep('ensure_personal_create', 'needs_other_phone');
      return { status: 'needsOtherPhone' };
    }
    logKeyStep('ensure_personal_create', reasonCode);
    return { status: 'enrollError', reasonCode };
  }
}

async function enrollPersonalWrapFromKey(input: {
  spaceId: string;
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
  personalKey: Uint8Array;
}): Promise<void> {
  const wrapped = wrapPersonalKeyToDevice(input.personalKey, input.publicKey, {
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
}

/** True when this device already has a family wrap (let in / approved). */
export async function deviceHasFamilyWrap(
  spaceId: string,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('family_key_wraps')
    .select('device_id')
    .eq('family_space_id', spaceId)
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) {
    logKeyStep('device_has_family_wrap', error.code ?? 'unknown');
    throw error;
  }
  return Boolean(data);
}

/**
 * After let-in, the family wrap exists but personal wrap may be missing (admin
 * let-in only wraps the family key). If this phone already holds the personal
 * key in cache, enroll a wrap for the approved device id only — never approve
 * a new device here.
 */
export async function enrollPersonalWrapFromCacheIfApproved(input: {
  spaceId: string;
  userId: string;
  personalKey: Uint8Array;
}): Promise<'enrolled' | 'already' | 'not_approved'> {
  const device = await ensureDeviceIdentity(input.userId);
  if (!(await deviceHasFamilyWrap(input.spaceId, input.userId, device.deviceId))) {
    return 'not_approved';
  }
  const wrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
  if (wrap) {
    return 'already';
  }
  await enrollPersonalWrapFromKey({
    spaceId: input.spaceId,
    userId: input.userId,
    deviceId: device.deviceId,
    publicKey: device.publicKey,
    personalKey: input.personalKey,
  });
  return 'enrolled';
}

export async function loadPersonalKeyIfPresent(input: {
  spaceId: string;
  userId: string;
}): Promise<Uint8Array | null> {
  const cached = await loadCachedPersonalKey(input.userId, input.spaceId);
  if (cached) {
    // Enroll errors must surface — Home/Family show a clear retry; do not swallow.
    await enrollPersonalWrapFromCacheIfApproved({
      spaceId: input.spaceId,
      userId: input.userId,
      personalKey: cached,
    });
    return cached;
  }
  if (!(await personalKeyExistsAnywhere(input.spaceId, input.userId))) {
    return null;
  }
  const device = await ensureDeviceIdentity(input.userId);
  const wrap = await fetchOwnPersonalWrap(input.spaceId, input.userId, device.deviceId);
  if (!wrap) {
    const { count, error: countError } = await supabase
      .from('personal_key_wraps')
      .select('device_id', { count: 'exact', head: true })
      .eq('family_space_id', input.spaceId)
      .eq('user_id', input.userId);
    throw new Error(
      `${personalKeyNeedsOtherPhone}:d=${device.deviceId.slice(0, 8)}:s=${input.spaceId.slice(0, 8)}:n=${
        countError ? 'err' : String(count ?? 0)
      }`,
    );
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
  // Never mint a second personal key when wraps or a recovery seal already exist.
  if (await personalKeyExistsAnywhere(input.spaceId, input.userId)) {
    throw new Error(personalKeyNeedsOtherPhone);
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
        if (await personalKeyExistsAnywhere(input.spaceId, input.userId)) {
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
  // Prefer cache so we do not recurse through obtainPersonalKey → loadPersonalKeyIfPresent.
  let personalKey = await loadCachedPersonalKey(input.userId, input.spaceId);
  if (!personalKey) {
    personalKey = await obtainPersonalKey({ spaceId: input.spaceId, userId: input.userId });
  }
  try {
    await enrollPersonalWrapFromKey({
      spaceId: input.spaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      publicKey: input.publicKey,
      personalKey,
    });
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
