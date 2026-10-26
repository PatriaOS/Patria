// SECURITY REVIEW REQUIRED
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { secretsEqual, wipe } from './bytes';
import { toPgBytea } from './pgBytea';
import { createRecoveryBoxes, openWithHolders } from './recovery';
import { randomKey32, randomUuid } from './random';
import { generatePrintedCode } from './printedCode';
import { wrapKeyToDevice, type MemberWrapAad } from './wrap';
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

describe('recovery setup local Supabase API', () => {
  it(
    'writes holder secrets and pair boxes then opens with two helpers',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const password = 'Api-recover-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-rk-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAuth = await service.auth.admin.createUser({
        email: `elder-rk-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const coAuth = await service.auth.admin.createUser({
        email: `co-rk-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (
        adminAuth.error ||
        elderAuth.error ||
        coAuth.error ||
        !adminAuth.data.user ||
        !elderAuth.data.user ||
        !coAuth.data.user
      ) {
        throw adminAuth.error ?? elderAuth.error ?? coAuth.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const elder = userClient();
      const co = userClient();
      await admin.auth.signInWithPassword({
        email: `admin-rk-${stamp}@patria.local`,
        password,
      });
      await elder.auth.signInWithPassword({
        email: `elder-rk-${stamp}@patria.local`,
        password,
      });
      await co.auth.signInWithPassword({
        email: `co-rk-${stamp}@patria.local`,
        password,
      });
      admin.auth.stopAutoRefresh();
      elder.auth.stopAutoRefresh();
      co.auth.stopAutoRefresh();
      const adminId = adminAuth.data.user.id;
      const elderId = elderAuth.data.user.id;
      const coId = coAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Recovery ${stamp}`,
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
      const addCo = await service.from('space_members').insert({
        family_space_id: spaceId,
        user_id: coId,
        role: 'co_admin',
      });
      if (addElder.error || addCo.error) {
        throw addElder.error ?? addCo.error;
      }
      const adminDevice = generateDeviceKeyPair();
      const elderDevice = generateDeviceKeyPair();
      const coDevice = generateDeviceKeyPair();
      const adminDeviceId = randomUuid();
      const elderDeviceId = randomUuid();
      const coDeviceId = randomUuid();
      const familyKey = randomKey32();
      const recoveryKey = randomKey32();
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
      const elderKey = await elder.from('device_keys').insert({
        user_id: elderId,
        device_id: elderDeviceId,
        public_key: toPgBytea(elderDevice.publicKey),
      });
      const coKey = await co.from('device_keys').insert({
        user_id: coId,
        device_id: coDeviceId,
        public_key: toPgBytea(coDevice.publicKey),
      });
      if (elderKey.error || coKey.error) {
        throw elderKey.error ?? coKey.error;
      }
      const aadElder: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: elderId,
        deviceId: elderDeviceId,
      };
      const aadCo: MemberWrapAad = {
        familySpaceId: spaceId,
        keyEpoch: 1,
        userId: coId,
        deviceId: coDeviceId,
      };
      const wrapElder = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, elderDevice.publicKey, aadElder)),
        key_epoch: 1,
        approved_by: adminId,
      });
      const wrapCo = await admin.from('family_key_wraps').insert({
        family_space_id: spaceId,
        user_id: coId,
        device_id: coDeviceId,
        wrapped_key: toPgBytea(wrapKeyToDevice(familyKey, coDevice.publicKey, aadCo)),
        key_epoch: 1,
        approved_by: adminId,
      });
      if (wrapElder.error || wrapCo.error) {
        throw wrapElder.error ?? wrapCo.error;
      }
      const inviteElder = await admin.from('recovery_contacts').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: elderId,
        slot: 'a',
        created_by: adminId,
      });
      const inviteCo = await admin.from('recovery_contacts').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: coId,
        slot: 'b',
        created_by: adminId,
      });
      if (inviteElder.error || inviteCo.error) {
        throw inviteElder.error ?? inviteCo.error;
      }
      const acceptElder = await elder
        .from('recovery_contacts')
        .update({ status: 'accepted' })
        .eq('family_space_id', spaceId)
        .eq('user_id', elderId);
      const acceptCo = await co
        .from('recovery_contacts')
        .update({ status: 'accepted' })
        .eq('family_space_id', spaceId)
        .eq('user_id', coId);
      if (acceptElder.error || acceptCo.error) {
        throw acceptElder.error ?? acceptCo.error;
      }
      const secretA = randomKey32();
      const secretB = randomKey32();
      const paper = generatePrintedCode();
      const wrapA = await admin.from('recovery_contact_secrets').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: elderId,
        device_id: elderDeviceId,
        wrapped_secret: toPgBytea(wrapKeyToDevice(secretA, elderDevice.publicKey, aadElder)),
        recovery_key_epoch: 1,
      });
      const wrapB = await admin.from('recovery_contact_secrets').insert({
        family_space_id: spaceId,
        member_id: adminId,
        user_id: coId,
        device_id: coDeviceId,
        wrapped_secret: toPgBytea(wrapKeyToDevice(secretB, coDevice.publicKey, aadCo)),
        recovery_key_epoch: 1,
      });
      if (wrapA.error || wrapB.error) {
        throw wrapA.error ?? wrapB.error;
      }
      const boxes = createRecoveryBoxes(recoveryKey, secretA, secretB, paper.secret, {
        familySpaceId: spaceId,
        userId: adminId,
        recoveryKeyEpoch: 1,
      });
      const ab = await admin.from('recovery_pair_wraps').insert({
        family_space_id: spaceId,
        user_id: adminId,
        recovery_key_epoch: 1,
        pair_id: 'ab',
        wrapped_recovery_key: toPgBytea(boxes.boxAb),
      });
      if (ab.error) {
        throw ab.error;
      }
      const elderSecret = await elder
        .from('recovery_contact_secrets')
        .select('wrapped_secret')
        .eq('user_id', elderId)
        .maybeSingle();
      const adminSecret = await admin.from('recovery_contact_secrets').select('id');
      if (elderSecret.error || !elderSecret.data) {
        throw elderSecret.error ?? new Error('contact cannot read secret');
      }
      expect((adminSecret.data ?? []).length).toBe(0);
      const opened = openWithHolders(
        boxes,
        { id: 'a', secret: secretA },
        { id: 'b', secret: secretB },
        { familySpaceId: spaceId, userId: adminId, recoveryKeyEpoch: 1 },
      );
      expect(secretsEqual(opened, recoveryKey)).toBe(true);
      wipe(opened);
      wipe(familyKey);
      wipe(recoveryKey);
      wipe(secretA);
      wipe(secretB);
      await admin.auth.signOut();
      await elder.auth.signOut();
      await co.auth.signOut();
    },
    25000,
  );
});
