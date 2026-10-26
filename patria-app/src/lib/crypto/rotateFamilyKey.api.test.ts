// SECURITY REVIEW REQUIRED
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { toPgBytea } from './pgBytea';
import { wrapKeyToDevice, type MemberWrapAad } from './wrap';
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

describe('rotate family key after a key holder is removed', () => {
  it(
    'flags rotation on remove, then the admin commit advances epoch and remaining wraps',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const password = 'Api-rotate-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-rotate-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAuth = await service.auth.admin.createUser({
        email: `elder-rotate-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (adminAuth.error || elderAuth.error || !adminAuth.data.user || !elderAuth.data.user) {
        throw adminAuth.error ?? elderAuth.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const adminSession = await admin.auth.signInWithPassword({
        email: `admin-rotate-${stamp}@patria.local`,
        password,
      });
      if (adminSession.error) {
        throw adminSession.error;
      }
      admin.auth.stopAutoRefresh();
      const adminId = adminAuth.data.user.id;
      const elderId = elderAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Rotate ${stamp}`,
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
      const elderKey = await service.from('device_keys').insert({
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
      const elderWrap = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, elderDevice.publicKey, aadElder)),
        key_epoch: 1,
        approved_by: adminId,
      });
      if (elderWrap.error) {
        throw elderWrap.error;
      }

      const removed = await admin
        .from('space_members')
        .delete()
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId);
      if (removed.error) {
        throw removed.error;
      }

      const stillMember = await service
        .from('space_members')
        .select('user_id')
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId)
        .maybeSingle();
      expect(stillMember.data).toBeNull();

      const elder = userClient();
      const elderSession = await elder.auth.signInWithPassword({
        email: `elder-rotate-${stamp}@patria.local`,
        password,
      });
      if (elderSession.error) {
        throw elderSession.error;
      }
      elder.auth.stopAutoRefresh();
      const asRemoved = await Promise.all([
        elder
          .from('space_members')
          .select('role, family_spaces ( id, name )')
          .eq('user_id', elderId),
        elder
          .from('space_members')
          .select('id, user_id, role, relationship_label, profiles ( display_name )')
          .eq('family_space_id', spaceId),
        elder.from('family_key_wraps').select('device_id').eq('family_space_id', spaceId),
      ]);
      expect(asRemoved.every((row) => !row.error && (row.data?.length ?? 0) === 0)).toBe(true);
      await elder.auth.signOut();

      const flagged = await service
        .from('family_spaces')
        .select('rotation_needed')
        .eq('id', spaceId)
        .maybeSingle();
      expect(flagged.data?.rotation_needed).toBe(true);
      const before = await service
        .from('family_key_meta')
        .select('key_epoch')
        .eq('family_space_id', spaceId)
        .maybeSingle();
      expect(before.data?.key_epoch).toBe(1);

      const nextKey = randomKey32();
      const nextAdmin: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 2,
        userId: adminId,
        deviceId: adminDeviceId,
      };
      const rotated = await admin.rpc('rotate_family_key', {
        p_space_id: spaceId,
        p_expected_epoch: 1,
        p_user_ids: [adminId],
        p_device_ids: [adminDeviceId],
        p_wrapped_keys: [toPgBytea(wrapKeyToDevice(nextKey, adminDevice.publicKey, nextAdmin))],
        p_seal_user_ids: [],
        p_sealed_keys: [],
      });
      if (rotated.error) {
        throw rotated.error;
      }
      expect(rotated.data).toBe(2);

      const after = await service
        .from('family_spaces')
        .select('rotation_needed')
        .eq('id', spaceId)
        .maybeSingle();
      expect(after.data?.rotation_needed).toBe(false);
      const wraps = await service
        .from('family_key_wraps')
        .select('user_id, key_epoch')
        .eq('family_space_id', spaceId);
      expect(wraps.data?.some((row) => row.user_id === elderId)).toBe(false);
      expect(
        wraps.data?.filter((row) => row.user_id === adminId && row.key_epoch === 2).length,
      ).toBe(1);
      await admin.auth.signOut();
    },
    25000,
  );
});
