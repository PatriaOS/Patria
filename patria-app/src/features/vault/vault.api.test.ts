import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { toPgBytea } from '../../lib/crypto/pgBytea';
import { randomUuid } from '../../lib/crypto/random';

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

function hex(length: number, fill: number): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

describe('vault voice upload local API', () => {
  it(
    'refuses upsert on the vault bucket and accepts a first insert, then the family entry',
    async () => {
      if (!(await localReady())) {
        return;
      }
      const service = createClient(LOCAL_URL, LOCAL_SERVICE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const password = 'Api-vault-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-vault-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const contactA = await service.auth.admin.createUser({
        email: `a-vault-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const contactB = await service.auth.admin.createUser({
        email: `b-vault-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (
        adminAuth.error ||
        contactA.error ||
        contactB.error ||
        !adminAuth.data.user ||
        !contactA.data.user ||
        !contactB.data.user
      ) {
        throw adminAuth.error ?? contactA.error ?? contactB.error ?? new Error('createUser failed');
      }
      const admin = userClient();
      const session = await admin.auth.signInWithPassword({
        email: `admin-vault-${stamp}@patria.local`,
        password,
      });
      if (session.error) {
        throw session.error;
      }
      admin.auth.stopAutoRefresh();
      const adminId = adminAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Vault API ${stamp}`,
        p_relationship_label: 'Mom',
      });
      if (space.error || !space.data) {
        throw space.error ?? new Error('create_family_space failed');
      }
      const spaceId = String(space.data);
      const deviceId = randomUuid();
      const ceremony = await admin.rpc('commit_family_key_ceremony', {
        p_space_id: spaceId,
        p_device_id: deviceId,
        p_public_key: toPgBytea(hex(32, 7)),
        p_wrapped_family_key: toPgBytea(hex(80, 8)),
        p_key_epoch: 1,
      });
      if (ceremony.error) {
        throw ceremony.error;
      }
      const members = await service.from('space_members').insert([
        { family_space_id: spaceId, user_id: contactA.data.user.id, role: 'elder' },
        { family_space_id: spaceId, user_id: contactB.data.user.id, role: 'elder' },
      ]);
      if (members.error) {
        throw members.error;
      }
      const contacts = await service.from('recovery_contacts').insert([
        {
          family_space_id: spaceId,
          member_id: adminId,
          user_id: contactA.data.user.id,
          slot: 'a',
          status: 'accepted',
          created_by: adminId,
        },
        {
          family_space_id: spaceId,
          member_id: adminId,
          user_id: contactB.data.user.id,
          slot: 'b',
          status: 'accepted',
          created_by: adminId,
        },
      ]);
      if (contacts.error) {
        throw contacts.error;
      }
      const pub = await admin.from('recovery_public_keys').insert({
        family_space_id: spaceId,
        user_id: adminId,
        public_key: toPgBytea(hex(32, 9)),
        recovery_key_epoch: 1,
      });
      if (pub.error) {
        throw pub.error;
      }

      const entryId = randomUuid();
      const audioId = randomUuid();
      const path = `${spaceId}/${entryId}/${audioId}`;
      const body = hex(256 * 1024 + 16, 3).buffer;
      const upserted = await admin.storage.from('vault').upload(path, body, {
        contentType: 'application/octet-stream',
        upsert: true,
      });
      expect(upserted.error?.message).toMatch(/row-level security/i);

      const uploaded = await admin.storage.from('vault').upload(path, body, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
      expect(uploaded.error).toBeNull();

      const inserted = await admin.from('vault_entries').insert({
        id: entryId,
        family_space_id: spaceId,
        author_id: adminId,
        kind: 'decision',
        version: 1,
        key_epoch: 1,
        visibility: 'family',
        content_nonce: toPgBytea(hex(24, 4)),
        ciphertext: toPgBytea(hex(64, 5)),
        cek_nonce: toPgBytea(hex(24, 6)),
        wrapped_cek: toPgBytea(hex(48, 7)),
      });
      expect(inserted.error).toBeNull();
    },
    30000,
  );
});
