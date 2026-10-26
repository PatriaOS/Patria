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

describe('pgBytea local Supabase API', () => {
  it(
    'writes a public key and wrap through PostgREST then unwraps',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const password = 'Api-bytea-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAuth = await service.auth.admin.createUser({
        email: `elder-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (adminAuth.error || elderAuth.error || !adminAuth.data.user || !elderAuth.data.user) {
        throw adminAuth.error ?? elderAuth.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const elder = userClient();
      const adminSession = await admin.auth.signInWithPassword({
        email: `admin-${stamp}@patria.local`,
        password,
      });
      const elderSession = await elder.auth.signInWithPassword({
        email: `elder-${stamp}@patria.local`,
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
        p_name: `Bytea ${stamp}`,
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
      const elderDevice = generateDeviceKeyPair();
      const adminDeviceId = randomUuid();
      const elderDeviceId = randomUuid();
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

      const keyInsert = await elder.from('device_keys').insert({
        user_id: elderId,
        device_id: elderDeviceId,
        public_key: toPgBytea(elderDevice.publicKey),
      });
      if (keyInsert.error) {
        throw keyInsert.error;
      }
      const keys = await admin.from('device_keys').select('user_id, public_key').eq('user_id', elderId);
      if (keys.error || !keys.data?.[0]) {
        throw keys.error ?? new Error('missing elder public key');
      }
      const readKey = requireX25519PublicKey(fromPgBytea(keys.data[0].public_key));
      expect(bytesToHex(readKey)).toBe(bytesToHex(elderDevice.publicKey));

      const aadElder: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: elderId,
        deviceId: elderDeviceId,
      };
      const wrapped = wrapKeyToDevice(familyKey, readKey, aadElder);
      const wrapInsert = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_key: toPgBytea(wrapped),
        key_epoch: 1,
        approved_by: adminId,
      });
      if (wrapInsert.error) {
        throw wrapInsert.error;
      }
      const wrapRead = await elder
        .from('family_key_wraps')
        .select('wrapped_key, key_epoch')
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId)
        .eq('device_id', elderDeviceId)
        .maybeSingle();
      if (wrapRead.error || !wrapRead.data) {
        throw wrapRead.error ?? new Error('missing wrap');
      }
      const opened = unwrapKeyFromDevice(
        fromPgBytea(wrapRead.data.wrapped_key),
        elderDevice.privateKey,
        aadElder,
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
