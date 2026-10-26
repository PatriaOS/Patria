// SECURITY REVIEW REQUIRED
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

jest.mock('../supabase', () => ({
  supabase: {
    auth: { stopAutoRefresh: jest.fn(), signOut: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { secretsEqual, wipe } from './bytes';
import { fromPgBytea, toPgBytea } from './pgBytea';
import { generatePrintedCode } from './printedCode';
import { randomKey32, randomUuid } from './random';
import { createRecoveryBoxes } from './recovery';
import {
  approveRecoveryAsContact,
  finishLostPhoneRecovery,
  type RecoverFlowGateway,
  type RecoveryRequestRow,
} from './recoverFlow';
import {
  unwrapKeyFromDevice,
  wrapFamilyKeyToRecoveryPublic,
  wrapKeyToDevice,
  type MemberWrapAad,
} from './wrap';
import { generateDeviceKeyPair } from './x25519';

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function localReady(): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_ANON },
    });
    return response.ok || response.status === 200 || response.status === 404;
  } catch {
    return false;
  }
}

function userClient(): SupabaseClient {
  return createClient(LOCAL_URL, LOCAL_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function gatewayFor(client: SupabaseClient): RecoverFlowGateway {
  return {
    startRequest: async (spaceId, deviceId, publicKey) => {
      const { data, error } = await client.rpc('start_recovery_request', {
        p_space_id: spaceId,
        p_device_id: deviceId,
        p_public_key: toPgBytea(publicKey),
      });
      if (error) {
        throw error;
      }
      return data as string;
    },
    listRequests: async (spaceId) => {
      const { data, error } = await client
        .from('recovery_requests')
        .select(
          'id, family_space_id, user_id, new_device_id, started_at, not_before, expires_at, cancelled_at, cancelled_by, completed_at',
        )
        .eq('family_space_id', spaceId);
      if (error) {
        throw error;
      }
      return (data ?? []).map(
        (row): RecoveryRequestRow => ({
          id: row.id as string,
          spaceId: row.family_space_id as string,
          userId: row.user_id as string,
          newDeviceId: row.new_device_id as string,
          newDeviceCreatedAt: row.started_at as string,
          startedAt: row.started_at as string,
          notBefore: row.not_before as string,
          expiresAt: row.expires_at as string,
          cancelledAt: (row.cancelled_at as string | null) ?? null,
          cancelledBy: (row.cancelled_by as string | null) ?? null,
          completedAt: (row.completed_at as string | null) ?? null,
        }),
      );
    },
    cancelRequest: async (requestId) => {
      const { error } = await client.rpc('cancel_recovery_request', { p_request_id: requestId });
      if (error) {
        throw error;
      }
    },
    fetchDevicePublicKey: async (requestId) => {
      const { data, error } = await client.rpc('recovery_request_device_public_key', {
        p_request_id: requestId,
      });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as { public_key: unknown }[];
      if (!rows[0]) {
        throw new Error('missing device key');
      }
      return fromPgBytea(rows[0].public_key);
    },
    fetchOwnHolderSecret: async (spaceId, userId, deviceId) => {
      const { data, error } = await client
        .from('recovery_contact_secrets')
        .select('wrapped_secret, recovery_key_epoch, device_id')
        .eq('family_space_id', spaceId)
        .eq('user_id', userId)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (error) {
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
    approveHelper: async (requestId, slot, wrappedSecret) => {
      const { error } = await client.rpc('approve_recovery_helper', {
        p_request_id: requestId,
        p_slot: slot,
        p_wrapped_secret: toPgBytea(wrappedSecret),
      });
      if (error) {
        throw error;
      }
    },
    listHelpers: async (requestId) => {
      const { data, error } = await client
        .from('recovery_request_helpers')
        .select('slot, wrapped_secret')
        .eq('request_id', requestId);
      if (error) {
        throw error;
      }
      return (data ?? []).map((row) => ({
        slot: (row.slot === 'b' ? 'b' : 'a') as 'a' | 'b',
        wrappedSecret: fromPgBytea(row.wrapped_secret),
      }));
    },
    fetchPairBoxes: async (spaceId, userId, recoveryKeyEpoch) => {
      const { data, error } = await client
        .from('recovery_pair_wraps')
        .select('pair_id, wrapped_recovery_key')
        .eq('family_space_id', spaceId)
        .eq('user_id', userId)
        .eq('recovery_key_epoch', recoveryKeyEpoch);
      if (error) {
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
    fetchSealedFamilyKeys: async (spaceId, userId) => {
      const { data, error } = await client
        .from('family_key_under_recovery')
        .select('key_epoch, wrapped_family_key')
        .eq('family_space_id', spaceId)
        .eq('user_id', userId);
      if (error) {
        throw error;
      }
      return (data ?? []).map((row) => ({
        keyEpoch: row.key_epoch as number,
        sealed: fromPgBytea(row.wrapped_family_key),
      }));
    },
    fetchMeta: async (spaceId) => {
      const { data, error } = await client
        .from('family_key_meta')
        .select('key_epoch, recovery_key_epoch')
        .eq('family_space_id', spaceId)
        .maybeSingle();
      if (error) {
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
    fetchRecoveryEpoch: async (spaceId, userId) => {
      const { data, error } = await client
        .from('recovery_public_keys')
        .select('recovery_key_epoch')
        .eq('family_space_id', spaceId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return (data?.recovery_key_epoch as number | undefined) ?? null;
    },
    insertFamilyWrap: async (input) => {
      const { error } = await client.from('family_key_wraps').insert({
        family_space_id: input.spaceId,
        user_id: input.userId,
        device_id: input.deviceId,
        wrapped_key: toPgBytea(input.wrappedKey),
        key_epoch: input.keyEpoch,
        approved_by: input.approvedBy,
      });
      if (error) {
        throw error;
      }
    },
    completeRequest: async (requestId) => {
      const { error } = await client.rpc('complete_recovery_request', {
        p_request_id: requestId,
      });
      if (error) {
        throw error;
      }
    },
    listRemovedNotices: async () => [],
  };
}

describe('lost-phone recovery local Supabase API', () => {
  it(
    'finishes after a backdated wait without revoking the old wrap',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      service.auth.stopAutoRefresh();
      const password = 'Api-lost-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-lost-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAuth = await service.auth.admin.createUser({
        email: `elder-lost-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (adminAuth.error || elderAuth.error || !adminAuth.data.user || !elderAuth.data.user) {
        throw adminAuth.error ?? elderAuth.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const elder = userClient();
      await admin.auth.signInWithPassword({
        email: `admin-lost-${stamp}@patria.local`,
        password,
      });
      await elder.auth.signInWithPassword({
        email: `elder-lost-${stamp}@patria.local`,
        password,
      });
      admin.auth.stopAutoRefresh();
      elder.auth.stopAutoRefresh();
      const adminId = adminAuth.data.user.id;
      const elderId = elderAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Lost ${stamp}`,
        p_relationship_label: 'Mom',
      });
      if (space.error || !space.data) {
        throw space.error ?? new Error('create_family_space failed');
      }
      const spaceId = String(space.data);
      const addElder = await service.from('space_members').insert({
        family_space_id: spaceId,
        user_id: elderId,
        role: 'elder',
      });
      if (addElder.error) {
        throw addElder.error;
      }
      const oldDevice = generateDeviceKeyPair();
      const newDevice = generateDeviceKeyPair();
      const elderDevice = generateDeviceKeyPair();
      const oldDeviceId = randomUuid();
      const newDeviceId = randomUuid();
      const elderDeviceId = randomUuid();
      const familyKey = randomKey32();
      const recoveryPair = generateDeviceKeyPair();
      const aadAdmin: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: adminId,
        deviceId: oldDeviceId,
      };
      const ceremony = await admin.rpc('commit_family_key_ceremony', {
        p_space_id: spaceId,
        p_device_id: oldDeviceId,
        p_public_key: toPgBytea(oldDevice.publicKey),
        p_wrapped_family_key: toPgBytea(
          wrapKeyToDevice(familyKey, oldDevice.publicKey, aadAdmin),
        ),
        p_key_epoch: 1,
      });
      if (ceremony.error) {
        throw ceremony.error;
      }
      const elderKey = await elder.from('device_keys').insert({
        user_id: elderId,
        device_id: elderDeviceId,
        public_key: toPgBytea(elderDevice.publicKey),
      });
      if (elderKey.error) {
        throw elderKey.error;
      }
      const aadElder: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: elderId,
        deviceId: elderDeviceId,
      };
      const wrapElder = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, elderDevice.publicKey, aadElder)),
        key_epoch: 1,
        approved_by: adminId,
      });
      if (wrapElder.error) {
        throw wrapElder.error;
      }
      const invite = await admin.from('recovery_contacts').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: elderId,
        slot: 'a',
        created_by: adminId,
      });
      if (invite.error) {
        throw invite.error;
      }
      const accept = await elder
        .from('recovery_contacts')
        .update({ status: 'accepted' })
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId);
      if (accept.error) {
        throw accept.error;
      }
      const secretA = randomKey32();
      const secretB = randomKey32();
      const paper = generatePrintedCode();
      const holder = await admin.from('recovery_contact_secrets').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_secret: toPgBytea(wrapKeyToDevice(secretA, elderDevice.publicKey, aadElder)),
        recovery_key_epoch: 1,
      });
      if (holder.error) {
        throw holder.error;
      }
      const boxes = createRecoveryBoxes(
        recoveryPair.privateKey,
        secretA,
        secretB,
        paper.secret,
        {
          familySpaceId: spaceId,
          userId: adminId,
          recoveryKeyEpoch: 1,
        },
      );
      const pub = await admin.from('recovery_public_keys').insert({
        family_space_id: spaceId,
        user_id: adminId,
        public_key: toPgBytea(recoveryPair.publicKey),
        recovery_key_epoch: 1,
      });
      if (pub.error) {
        throw pub.error;
      }
      const sealed = await admin.from('family_key_under_recovery').insert({
        family_space_id: spaceId,
        user_id: adminId,
        key_epoch: 1,
        wrapped_family_key: toPgBytea(
          wrapFamilyKeyToRecoveryPublic(familyKey, recoveryPair.publicKey, {
            familySpaceId: spaceId,
            keyEpoch: 1,
            userId: adminId,
          }),
        ),
      });
      if (sealed.error) {
        throw sealed.error;
      }
      for (const pair of [
        { pair_id: 'ab', wrapped: boxes.boxAb },
        { pair_id: 'ap', wrapped: boxes.boxAp },
        { pair_id: 'bp', wrapped: boxes.boxBp },
      ] as const) {
        const inserted = await admin.from('recovery_pair_wraps').insert({
          family_space_id: spaceId,
          user_id: adminId,
          recovery_key_epoch: 1,
          pair_id: pair.pair_id,
          wrapped_recovery_key: toPgBytea(pair.wrapped),
        });
        if (inserted.error) {
          throw inserted.error;
        }
      }

      const waitBefore = await service
        .from('patria_key_settings')
        .update({ recovery_wait: '3 seconds' })
        .eq('singleton', 1);
      if (waitBefore.error) {
        throw waitBefore.error;
      }
      const recoveredGate = gatewayFor(admin);
      const requestId = await recoveredGate.startRequest(
        spaceId,
        newDeviceId,
        newDevice.publicKey,
      );
      const backdate = await service
        .from('recovery_requests')
        .update({
          not_before: new Date(Date.now() - 60_000).toISOString(),
          expires_at: new Date(Date.now() + 6 * 86400_000).toISOString(),
        })
        .eq('id', requestId);
      if (backdate.error) {
        throw backdate.error;
      }
      const restoreWait = await service
        .from('patria_key_settings')
        .update({ recovery_wait: '48 hours' })
        .eq('singleton', 1);
      if (restoreWait.error) {
        throw restoreWait.error;
      }

      const listed = await recoveredGate.listRequests(spaceId);
      const request = listed.find((row) => row.id === requestId);
      if (!request) {
        throw new Error('missing recovery request');
      }
      await approveRecoveryAsContact(
        {
          spaceId,
          request,
          slot: 'a',
          contactUserId: elderId,
          contactDeviceId: elderDeviceId,
          contactPrivateKey: elderDevice.privateKey,
        },
        gatewayFor(elder),
      );

      await finishLostPhoneRecovery(
        {
          spaceId,
          userId: adminId,
          role: 'family_admin',
          deviceId: newDeviceId,
          privateKey: newDevice.privateKey,
          publicKey: newDevice.publicKey,
          request,
          paperWords: paper.words,
        },
        recoveredGate,
      );

      const oldWrap = await admin
        .from('family_key_wraps')
        .select('wrapped_key')
        .eq('device_id', oldDeviceId)
        .maybeSingle();
      if (oldWrap.error || !oldWrap.data) {
        throw oldWrap.error ?? new Error('old wrap missing');
      }
      const stillOld = unwrapKeyFromDevice(
        fromPgBytea(oldWrap.data.wrapped_key),
        oldDevice.privateKey,
        aadAdmin,
      );
      expect(secretsEqual(stillOld, familyKey)).toBe(true);
      const newWrap = await admin
        .from('family_key_wraps')
        .select('wrapped_key')
        .eq('device_id', newDeviceId)
        .maybeSingle();
      if (newWrap.error || !newWrap.data) {
        throw newWrap.error ?? new Error('new wrap missing');
      }
      const openedNew = unwrapKeyFromDevice(fromPgBytea(newWrap.data.wrapped_key), newDevice.privateKey, {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: adminId,
        deviceId: newDeviceId,
      });
      expect(secretsEqual(openedNew, familyKey)).toBe(true);
      wipe(stillOld);
      wipe(openedNew);
      wipe(familyKey);
      wipe(recoveryPair.privateKey);
      wipe(secretA);
      wipe(secretB);
      await admin.auth.signOut();
      await elder.auth.signOut();
    },
    25000,
  );
});
