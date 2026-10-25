// SECURITY REVIEW REQUIRED
import { logKeyStep } from '../devLog';
import { isSpaceAdmin } from '../roles';
import { supabase } from '../supabase';
import { wipe } from './bytes';
import { ensureDeviceIdentity } from './deviceIdentity';
import { cacheFamilySecrets, obtainFamilyKey } from './keyStore';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';
import { randomKey32 } from './random';
import { rewrapVaultCek } from './vaultEnvelope';
import { wrapFamilyKeyToRecoveryPublic, wrapKeyToDevice } from './wrap';
import { supabaseDeviceAccessGateway } from './deviceAccess';

export type VaultCekRow = {
  id: string;
  version: number;
  keyEpoch: number;
  cekNonce: Uint8Array;
  wrappedCek: Uint8Array;
};

export type RotationTarget = {
  userId: string;
  deviceId: string;
  publicKey: Uint8Array;
};

export type RecoverySealTarget = {
  userId: string;
  publicKey: Uint8Array;
};

export type RotateFamilyKeyGateway = {
  fetchRotationNeeded(spaceId: string): Promise<{ needed: boolean; keyEpoch: number } | null>;
  listWrapTargets(spaceId: string): Promise<RotationTarget[]>;
  listSealTargets(spaceId: string): Promise<RecoverySealTarget[]>;
  listVaultCeks(spaceId: string): Promise<VaultCekRow[]>;
  commitRotation(input: {
    spaceId: string;
    expectedEpoch: number;
    userIds: string[];
    deviceIds: string[];
    wrappedKeys: Uint8Array[];
    sealUserIds: string[];
    sealedKeys: Uint8Array[];
    entryIds: string[];
    wrappedCeks: Uint8Array[];
    cekNonces: Uint8Array[];
  }): Promise<number>;
};

export const supabaseRotateFamilyKeyGateway: RotateFamilyKeyGateway = {
  async fetchRotationNeeded(spaceId) {
    const { data: space, error: spaceError } = await supabase
      .from('family_spaces')
      .select('rotation_needed')
      .eq('id', spaceId)
      .maybeSingle();
    if (spaceError) {
      logKeyStep('fetch_rotation_needed', spaceError.code ?? 'unknown');
      throw spaceError;
    }
    if (!space) {
      return null;
    }
    const { data: meta, error: metaError } = await supabase
      .from('family_key_meta')
      .select('key_epoch')
      .eq('family_space_id', spaceId)
      .maybeSingle();
    if (metaError) {
      logKeyStep('fetch_rotation_epoch', metaError.code ?? 'unknown');
      throw metaError;
    }
    if (!meta) {
      return null;
    }
    return {
      needed: Boolean(space.rotation_needed),
      keyEpoch: meta.key_epoch as number,
    };
  },

  async listWrapTargets(spaceId) {
    const { data, error } = await supabase.rpc('rotation_wrap_targets', {
      p_space_id: spaceId,
    });
    if (error) {
      logKeyStep('list_rotation_targets', error.code ?? 'unknown');
      throw error;
    }
    return ((data ?? []) as { user_id: string; device_id: string; public_key: unknown }[]).map(
      (row) => ({
        userId: row.user_id,
        deviceId: row.device_id,
        publicKey: requireX25519PublicKey(fromPgBytea(row.public_key)),
      }),
    );
  },

  async listSealTargets(spaceId) {
    const { data, error } = await supabase
      .from('recovery_public_keys')
      .select('user_id, public_key')
      .eq('family_space_id', spaceId);
    if (error) {
      logKeyStep('list_recovery_public_keys', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      userId: row.user_id as string,
      publicKey: requireX25519PublicKey(fromPgBytea(row.public_key)),
    }));
  },

  async listVaultCeks(spaceId) {
    const { data, error } = await supabase
      .from('vault_entries')
      .select('id, version, key_epoch, cek_nonce, wrapped_cek, visibility')
      .eq('family_space_id', spaceId)
      .eq('visibility', 'family');
    if (error) {
      logKeyStep('list_vault_ceks', error.code ?? 'unknown');
      throw error;
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      version: row.version as number,
      keyEpoch: row.key_epoch as number,
      cekNonce: fromPgBytea(row.cek_nonce),
      wrappedCek: fromPgBytea(row.wrapped_cek),
    }));
  },

  async commitRotation(input) {
    const { data, error } = await supabase.rpc('rotate_family_key', {
      p_space_id: input.spaceId,
      p_expected_epoch: input.expectedEpoch,
      p_user_ids: input.userIds,
      p_device_ids: input.deviceIds,
      p_wrapped_keys: input.wrappedKeys.map((row) => toPgBytea(row)),
      p_seal_user_ids: input.sealUserIds,
      p_sealed_keys: input.sealedKeys.map((row) => toPgBytea(row)),
      p_entry_ids: input.entryIds,
      p_wrapped_ceks: input.wrappedCeks.map((row) => toPgBytea(row)),
      p_cek_nonces: input.cekNonces.map((row) => toPgBytea(row)),
    });
    if (error) {
      logKeyStep('rotate_family_key', error.code ?? 'unknown');
      throw error;
    }
    return data as number;
  },
};

export type RotationOutcome = 'idle' | 'rotated' | 'alreadyCurrent' | 'failed';

export type HomeRotationUi = 'hidden' | 'updating' | 'upToDate' | 'failed';

export function homeRotationQueryKey(spaceId: string): ['homeRotationUi', string] {
  return ['homeRotationUi', spaceId];
}

export function homeRotationUiFromOutcome(outcome: RotationOutcome): HomeRotationUi {
  if (outcome === 'failed') {
    return 'failed';
  }
  if (outcome === 'rotated' || outcome === 'alreadyCurrent') {
    return 'upToDate';
  }
  return 'hidden';
}

async function lostCompareAndSwap(
  gateway: RotateFamilyKeyGateway,
  spaceId: string,
  expectedEpoch: number,
): Promise<boolean> {
  try {
    const latest = await gateway.fetchRotationNeeded(spaceId);
    if (!latest) {
      return true;
    }
    if (!latest.needed) {
      return true;
    }
    return latest.keyEpoch !== expectedEpoch;
  } catch {
    return false;
  }
}

export async function rotateFamilyKeyIfNeeded(
  input: { spaceId: string; userId: string; role: string | null | undefined },
  gateway: RotateFamilyKeyGateway = supabaseRotateFamilyKeyGateway,
  onWorking?: () => void,
): Promise<RotationOutcome> {
  if (!isSpaceAdmin(input.role)) {
    return 'idle';
  }
  const state = await gateway.fetchRotationNeeded(input.spaceId);
  if (!state?.needed) {
    return 'idle';
  }
  onWorking?.();
  const device = await ensureDeviceIdentity(input.userId);
  const oldKey = await obtainFamilyKey({
    userId: input.userId,
    spaceId: input.spaceId,
    deviceId: device.deviceId,
    privateKey: device.privateKey,
    fetchOwnWrap: supabaseDeviceAccessGateway.fetchOwnWrap,
  });
  if (!oldKey) {
    return 'failed';
  }
  const nextEpoch = state.keyEpoch + 1;
  const newKey = randomKey32();
  const opened: Uint8Array[] = [oldKey, newKey];
  try {
    const targets = await gateway.listWrapTargets(input.spaceId);
    const seals = await gateway.listSealTargets(input.spaceId);
    const wrappedKeys = targets.map((row) =>
      wrapKeyToDevice(newKey, row.publicKey, {
        familySpaceId: input.spaceId,
        keyEpoch: nextEpoch,
        userId: row.userId,
        deviceId: row.deviceId,
      }),
    );
    const sealedKeys = seals.map((row) =>
      wrapFamilyKeyToRecoveryPublic(newKey, row.publicKey, {
        familySpaceId: input.spaceId,
        keyEpoch: nextEpoch,
        userId: row.userId,
      }),
    );
    let committed = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const entries = (await gateway.listVaultCeks(input.spaceId)).filter(
        (row) => row.keyEpoch === state.keyEpoch,
      );
      const rewraps = entries.map((row) =>
        rewrapVaultCek(oldKey, newKey, {
          wrappedCek: row.wrappedCek,
          cekNonce: row.cekNonce,
          familySpaceId: input.spaceId,
          entryId: row.id,
          version: row.version,
          oldEpoch: state.keyEpoch,
          nextEpoch,
        }),
      );
      try {
        await gateway.commitRotation({
          spaceId: input.spaceId,
          expectedEpoch: state.keyEpoch,
          userIds: targets.map((row) => row.userId),
          deviceIds: targets.map((row) => row.deviceId),
          wrappedKeys,
          sealUserIds: seals.map((row) => row.userId),
          sealedKeys,
          entryIds: entries.map((row) => row.id),
          wrappedCeks: rewraps.map((row) => row.wrappedCek),
          cekNonces: rewraps.map((row) => row.nonce),
        });
        committed = true;
        break;
      } catch (error) {
        logKeyStep('rotate_family_key', 'commit');
        if (await lostCompareAndSwap(gateway, input.spaceId, state.keyEpoch)) {
          return 'alreadyCurrent';
        }
        if (attempt === 2) {
          throw error;
        }
      }
    }
    if (!committed) {
      throw new Error('rotate failed');
    }
    await cacheFamilySecrets(input.userId, input.spaceId, newKey);
    logKeyStep('rotate_family_key', `${input.spaceId} ${nextEpoch}`);
    return 'rotated';
  } catch {
    return 'failed';
  } finally {
    for (const secret of opened) {
      wipe(secret);
    }
  }
}
