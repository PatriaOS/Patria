// SECURITY REVIEW REQUIRED
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { secretsEqual, wipe } from './bytes';
import { fromPgBytea, requireX25519PublicKey, toPgBytea } from './pgBytea';
import { unwrapKeyFromDevice, wrapKeyToDevice, type MemberWrapAad } from './wrap';
import { generateDeviceKeyPair } from './x25519';
import { randomKey32, randomUuid } from './random';

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

describe('extra-device local Supabase API', () => {
  it(
    'writes an extra-device wrap through PostgREST then unwraps',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const password = 'Api-extra-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-extra-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAuth = await service.auth.admin.createUser({
        email: `elder-extra-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (adminAuth.error || elderAuth.error || !adminAuth.data.user || !elderAuth.data.user) {
        throw adminAuth.error ?? elderAuth.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const elder = userClient();
      const adminSession = await admin.auth.signInWithPassword({
        email: `admin-extra-${stamp}@patria.local`,
        password,
      });
      const elderSession = await elder.auth.signInWithPassword({
        email: `elder-extra-${stamp}@patria.local`,
        password,
      });
      if (adminSession.error || elderSession.error) {
        throw adminSession.error ?? elderSession.error;
      }
      admin.auth.stopAutoRefresh();
      elder.auth.stopAutoRefresh();
      const adminId = adminAuth.data.user.id;
      const elderId = elderAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Extra ${stamp}`,
        p_relationship_label: 'Mom',
      });
      if (space.error || !space.data) {
        throw space.error ?? new Error('create_family_space failed');
      }
      const spaceId = String(space.data);
      const memberInsert = await service.from('space_members').insert({
        family_space_id: spaceId,
        user_id: elderId,
        role: 'elder',
      });
      if (memberInsert.error) {
        throw memberInsert.error;
      }

      const adminDevice = generateDeviceKeyPair();
      const elderPhone1 = generateDeviceKeyPair();
      const elderPhone2 = generateDeviceKeyPair();
      const adminDeviceId = randomUuid();
      const elderDevice1 = randomUuid();
      const elderDevice2 = randomUuid();
      const familyKey = randomKey32();
      const aadAdmin: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: adminId,
        deviceId: adminDeviceId,
      };
      const ceremony = await admin.rpc('commit_family_key_ceremony', {
        p_space_id: spaceId,
        p_device_id: adminDeviceId,
        p_public_key: toPgBytea(adminDevice.publicKey),
        p_wrapped_family_key: toPgBytea(
          wrapKeyToDevice(familyKey, adminDevice.publicKey, aadAdmin),
        ),
        p_key_epoch: 1,
      });
      if (ceremony.error) {
        throw ceremony.error;
      }

      const firstKey = await elder.from('device_keys').insert({
        user_id: elderId,
        device_id: elderDevice1,
        public_key: toPgBytea(elderPhone1.publicKey),
      });
      if (firstKey.error) {
        throw firstKey.error;
      }
      const aadFirst: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: elderId,
        deviceId: elderDevice1,
      };
      const firstWrap = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDevice1,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, elderPhone1.publicKey, aadFirst)),
        key_epoch: 1,
        approved_by: adminId,
      });
      if (firstWrap.error) {
        throw firstWrap.error;
      }

      const extraKey = await elder.from('device_keys').insert({
        user_id: elderId,
        device_id: elderDevice2,
        public_key: toPgBytea(elderPhone2.publicKey),
      });
      if (extraKey.error) {
        throw extraKey.error;
      }
      const aadExtra: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: elderId,
        deviceId: elderDevice2,
      };
      const adminExtra = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDevice2,
        wrapped_key: toPgBytea(
          wrapKeyToDevice(familyKey, elderPhone2.publicKey, aadExtra),
        ),
        key_epoch: 1,
        approved_by: adminId,
      });
      expect(adminExtra.error).toBeTruthy();

      const keys = await elder
        .from('device_keys')
        .select('public_key')
        .eq('user_id', elderId)
        .eq('device_id', elderDevice2)
        .maybeSingle();
      if (keys.error || !keys.data) {
        throw keys.error ?? new Error('missing extra public key');
      }
      const readKey = requireX25519PublicKey(fromPgBytea(keys.data.public_key));
      expect(bytesToHex(readKey)).toBe(bytesToHex(elderPhone2.publicKey));
      const extraWrap = await elder.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDevice2,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, readKey, aadExtra)),
        key_epoch: 1,
        approved_by: elderId,
      });
      if (extraWrap.error) {
        throw extraWrap.error;
      }
      const wrapRead = await elder
        .from('family_key_wraps')
        .select('wrapped_key, key_epoch')
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId)
        .eq('device_id', elderDevice2)
        .maybeSingle();
      if (wrapRead.error || !wrapRead.data) {
        throw wrapRead.error ?? new Error('missing extra wrap');
      }
      const opened = unwrapKeyFromDevice(
        fromPgBytea(wrapRead.data.wrapped_key),
        elderPhone2.privateKey,
        aadExtra,
      );
      expect(secretsEqual(opened, familyKey)).toBe(true);
      wipe(opened);
      wipe(familyKey);
      await admin.auth.signOut();
      await elder.auth.signOut();
    },
    20000,
  );
});
