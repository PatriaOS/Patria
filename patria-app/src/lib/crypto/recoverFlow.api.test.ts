// SECURITY REVIEW REQUIRED
/**
 * Local Supabase only (127.0.0.1:54321). Real crypto + PostgREST path for
 * lost-phone finish with A+B and empty paper (ab-only / repair shape).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { secretsEqual, wipe } from './bytes';
import {
  deviceIdStoreKey,
  devicePrivateStoreKey,
  resetDeviceIdentityMemory,
} from './deviceIdentity';
import { cacheFamilySecrets, cachePersonalKey, resetFamilyKeyMemory } from './keyStore';
import { fromPgBytea, toPgBytea } from './pgBytea';
import {
  unwrapPersonalKeyFromDevice,
  wrapPersonalKeyToDevice,
  wrapPersonalKeyToRecovery,
} from './personalKey';
import { randomKey32, randomUuid } from './random';
import { createRecoveryBoxes } from './recovery';
import {
  approveRecoveryAsContact,
  finishLostPhoneRecovery,
  type RecoverFlowGateway,
  type RecoveryRequestRow,
} from './recoverFlow';
import { supabaseRecoveryAccessGateway } from './recoveryAccess';
import { repairRecoverySetup } from './recoverySetup';
import { setSecretBytes, setSecretText } from './secureKeys';
import {
  unwrapKeyFromDevice,
  wrapFamilyKeyToRecoveryPublic,
  wrapKeyToDevice,
  type MemberWrapAad,
} from './wrap';
import { generateDeviceKeyPair } from './x25519';

jest.mock('../supabase', () => ({
  get supabase() {
    const client = (globalThis as { __patriaRecoverApiClient?: SupabaseClient })
      .__patriaRecoverApiClient;
    if (!client) {
      throw new Error('test supabase client not set');
    }
    return client;
  },
}));

type NodeHttp = {
  get: (
    url: string,
    options: { headers: Record<string, string> },
    cb: (res: {
      statusCode?: number;
      statusMessage?: string;
      headers: Record<string, string | string[] | undefined>;
      resume: () => void;
      on: (event: string, cb: (chunk?: Uint8Array) => void) => void;
    }) => void,
  ) => {
    on: (event: string, cb: (err: Error) => void) => void;
    setTimeout: (ms: number, cb: () => void) => void;
    destroy: () => void;
  };
  request: (
    url: URL,
    options: { method: string; headers: Record<string, string> },
    cb: (res: {
      statusCode?: number;
      statusMessage?: string;
      headers: Record<string, string | string[] | undefined>;
      on: (event: string, cb: (chunk?: Uint8Array) => void) => void;
    }) => void,
  ) => {
    on: (event: string, cb: (err: Error) => void) => void;
    write: (body: string | Uint8Array) => void;
    end: () => void;
  };
};

// jest-expo has no Node types in tsconfig; load http at runtime for local Supabase.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http') as NodeHttp;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https = require('https') as NodeHttp;

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** jest-expo replaces fetch; Supabase Auth needs a real HTTP body. */
function nodeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw);
    const lib = u.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {};
    const src = init.headers;
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      if (src instanceof Headers) {
        src.forEach((value, key) => {
          headers[key] = value;
        });
      } else {
        for (const [key, value] of Object.entries(src as Record<string, string>)) {
          headers[key] = value;
        }
      }
    }
    const method = init.method ?? 'GET';
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks: Uint8Array[] = [];
      res.on('data', (chunk) => {
        if (chunk) {
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        let total = 0;
        for (const part of chunks) {
          total += part.byteLength;
        }
        const buf = new Uint8Array(total);
        let offset = 0;
        for (const part of chunks) {
          buf.set(part, offset);
          offset += part.byteLength;
        }
        const status = res.statusCode ?? 0;
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders.set(key, value);
          } else if (Array.isArray(value)) {
            responseHeaders.set(key, value.join(', '));
          }
        }
        // Fetch Response rejects a body with 204/205/304.
        const empty = status === 204 || status === 205 || status === 304;
        resolve(
          new Response(empty ? null : buf, {
            status,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
          }),
        );
      });
    });
    req.on('error', reject);
    if (init.body != null) {
      if (typeof init.body === 'string') {
        req.write(init.body);
      } else if (init.body instanceof Uint8Array) {
        req.write(init.body);
      } else {
        reject(new Error('unsupported fetch body'));
        return;
      }
    }
    req.end();
  });
}

async function localReady(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `${LOCAL_URL}/rest/v1/`,
        { headers: { apikey: LOCAL_ANON } },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`status ${res.statusCode}`));
          }
        },
      );
      req.on('error', reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
    return true;
  } catch {
    return false;
  }
}

function setActiveClient(client: SupabaseClient): void {
  (globalThis as { __patriaRecoverApiClient?: SupabaseClient }).__patriaRecoverApiClient = client;
}

function userClient(): SupabaseClient {
  return createClient(LOCAL_URL, LOCAL_ANON, {
    global: { fetch: nodeFetch as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(LOCAL_URL, LOCAL_SERVICE, {
    global: { fetch: nodeFetch as typeof fetch },
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
      if (!ab) {
        return null;
      }
      return {
        boxAb: fromPgBytea(ab.wrapped_recovery_key),
        boxAp: ap ? fromPgBytea(ap.wrapped_recovery_key) : null,
        boxBp: bp ? fromPgBytea(bp.wrapped_recovery_key) : null,
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

async function advanceWait(service: SupabaseClient, requestId: string): Promise<void> {
  const waitBefore = await service
    .from('patria_key_settings')
    .update({ recovery_wait: '3 seconds' })
    .eq('singleton', 1);
  if (waitBefore.error) {
    throw waitBefore.error;
  }
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
}

async function installDeviceIdentity(
  userId: string,
  deviceId: string,
  privateKey: Uint8Array,
): Promise<void> {
  await setSecretText(deviceIdStoreKey(userId), deviceId);
  await setSecretBytes(devicePrivateStoreKey(userId), privateKey);
}

describe('lost-phone recovery local Supabase API', () => {
  const secureStore = new Map<string, string>();

  beforeEach(() => {
    secureStore.clear();
    resetDeviceIdentityMemory();
    resetFamilyKeyMemory();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      return secureStore.get(key) ?? null;
    });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(
      async (key: string, value: string) => {
        secureStore.set(key, value);
      },
    );
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      secureStore.delete(key);
    });
  });

  it(
    'finishes with contact A and B and no printed code when only ab exists',
    async () => {
      if (!(await localReady())) {
        throw new Error('local Supabase at 127.0.0.1:54321 is required');
      }
      const service = serviceClient();
      service.auth.stopAutoRefresh();
      const password = 'Api-ab-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-ab-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAAuth = await service.auth.admin.createUser({
        email: `elder-a-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderBAuth = await service.auth.admin.createUser({
        email: `elder-b-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (
        adminAuth.error ||
        elderAAuth.error ||
        elderBAuth.error ||
        !adminAuth.data.user ||
        !elderAAuth.data.user ||
        !elderBAuth.data.user
      ) {
        throw (
          adminAuth.error ??
          elderAAuth.error ??
          elderBAuth.error ??
          new Error('createUser failed')
        );
      }
      const admin = userClient();
      const elderA = userClient();
      const elderB = userClient();
      await admin.auth.signInWithPassword({
        email: `admin-ab-${stamp}@patria.local`,
        password,
      });
      await elderA.auth.signInWithPassword({
        email: `elder-a-${stamp}@patria.local`,
        password,
      });
      await elderB.auth.signInWithPassword({
        email: `elder-b-${stamp}@patria.local`,
        password,
      });
      admin.auth.stopAutoRefresh();
      elderA.auth.stopAutoRefresh();
      elderB.auth.stopAutoRefresh();
      setActiveClient(admin);
      const adminId = adminAuth.data.user.id;
      const elderAId = elderAAuth.data.user.id;
      const elderBId = elderBAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `AB ${stamp}`,
        p_relationship_label: 'Mom',
      });
      if (space.error || !space.data) {
        throw space.error ?? new Error('create_family_space failed');
      }
      const spaceId = String(space.data);
      for (const [id, role] of [
        [elderAId, 'elder'],
        [elderBId, 'elder'],
      ] as const) {
        const added = await service.from('space_members').insert({
          family_space_id: spaceId,
          user_id: id,
          role,
        });
        if (added.error) {
          throw added.error;
        }
      }
      const oldDevice = generateDeviceKeyPair();
      const newDevice = generateDeviceKeyPair();
      const contactADevice = generateDeviceKeyPair();
      const contactBDevice = generateDeviceKeyPair();
      const oldDeviceId = randomUuid();
      const newDeviceId = randomUuid();
      const contactADeviceId = randomUuid();
      const contactBDeviceId = randomUuid();
      const familyKey = randomKey32();
      const personalKey = randomKey32();
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
      for (const row of [
        { userId: elderAId, deviceId: contactADeviceId, pub: contactADevice.publicKey },
        { userId: elderBId, deviceId: contactBDeviceId, pub: contactBDevice.publicKey },
      ]) {
        const dk = await service.from('device_keys').insert({
          user_id: row.userId,
          device_id: row.deviceId,
          public_key: toPgBytea(row.pub),
        });
        if (dk.error) {
          throw dk.error;
        }
        const wrap = await admin.from('family_key_wraps').insert({
          family_space_id: spaceId,
          user_id: row.userId,
          device_id: row.deviceId,
          wrapped_key: toPgBytea(
            wrapKeyToDevice(familyKey, row.pub, {
              familySpaceId: spaceId,
              keyEpoch: 1,
              userId: row.userId,
              deviceId: row.deviceId,
            }),
          ),
          key_epoch: 1,
          approved_by: adminId,
        });
        if (wrap.error) {
          throw wrap.error;
        }
      }
      for (const [userId, client, slot] of [
        [elderAId, elderA, 'a'],
        [elderBId, elderB, 'b'],
      ] as const) {
        const invite = await admin.from('recovery_contacts').insert({
          family_space_id: spaceId,
          member_id: adminId,
          user_id: userId,
          slot,
          created_by: adminId,
        });
        if (invite.error) {
          throw invite.error;
        }
        const accept = await client
          .from('recovery_contacts')
          .update({ status: 'accepted' })
          .eq('family_space_id', spaceId)
          .eq('user_id', userId);
        if (accept.error) {
          throw accept.error;
        }
      }
      const secretA = randomKey32();
      const secretB = randomKey32();
      const ephemeralPaper = randomKey32();
      const boxes = createRecoveryBoxes(recoveryPair.privateKey, secretA, secretB, ephemeralPaper, {
        familySpaceId: spaceId,
        userId: adminId,
        recoveryKeyEpoch: 1,
      });
      wipe(ephemeralPaper);
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
      const personalSeal = await service.from('personal_key_under_recovery').insert({
        family_space_id: spaceId,
        user_id: adminId,
        wrapped_key: toPgBytea(
          wrapPersonalKeyToRecovery(personalKey, recoveryPair.publicKey, spaceId, adminId),
        ),
      });
      if (personalSeal.error) {
        throw personalSeal.error;
      }
      const abOnly = await admin.from('recovery_pair_wraps').insert({
        family_space_id: spaceId,
        user_id: adminId,
        recovery_key_epoch: 1,
        pair_id: 'ab',
        wrapped_recovery_key: toPgBytea(boxes.boxAb),
      });
      if (abOnly.error) {
        throw abOnly.error;
      }
      for (const row of [
        {
          userId: elderAId,
          deviceId: contactADeviceId,
          pub: contactADevice.publicKey,
          secret: secretA,
        },
        {
          userId: elderBId,
          deviceId: contactBDeviceId,
          pub: contactBDevice.publicKey,
          secret: secretB,
        },
      ]) {
        const holder = await admin.from('recovery_contact_secrets').insert({
          family_space_id: spaceId,
          member_id: adminId,
          user_id: row.userId,
          device_id: row.deviceId,
          wrapped_secret: toPgBytea(
            wrapKeyToDevice(row.secret, row.pub, {
              familySpaceId: spaceId,
              keyEpoch: 1,
              userId: row.userId,
              deviceId: row.deviceId,
            }),
          ),
          recovery_key_epoch: 1,
        });
        if (holder.error) {
          throw holder.error;
        }
      }

      // Lost phone: new device identity only.
      await installDeviceIdentity(adminId, newDeviceId, newDevice.privateKey);
      const recoveredGate = gatewayFor(admin);
      const requestId = await recoveredGate.startRequest(
        spaceId,
        newDeviceId,
        newDevice.publicKey,
      );
      await advanceWait(service, requestId);
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
          contactUserId: elderAId,
          contactDeviceId: contactADeviceId,
          contactPrivateKey: contactADevice.privateKey,
        },
        gatewayFor(elderA),
      );
      await approveRecoveryAsContact(
        {
          spaceId,
          request,
          slot: 'b',
          contactUserId: elderBId,
          contactDeviceId: contactBDeviceId,
          contactPrivateKey: contactBDevice.privateKey,
        },
        gatewayFor(elderB),
      );

      setActiveClient(admin);
      await finishLostPhoneRecovery(
        {
          spaceId,
          userId: adminId,
          role: 'family_admin',
          deviceId: newDeviceId,
          privateKey: newDevice.privateKey,
          publicKey: newDevice.publicKey,
          request,
          paperWords: '',
        },
        recoveredGate,
      );

      const newWrap = await admin
        .from('family_key_wraps')
        .select('wrapped_key')
        .eq('device_id', newDeviceId)
        .maybeSingle();
      if (newWrap.error || !newWrap.data) {
        throw newWrap.error ?? new Error('new wrap missing after A+B finish');
      }
      const openedNew = unwrapKeyFromDevice(
        fromPgBytea(newWrap.data.wrapped_key),
        newDevice.privateKey,
        {
          familySpaceId: spaceId,
          keyEpoch: 1,
          userId: adminId,
          deviceId: newDeviceId,
        },
      );
      expect(secretsEqual(openedNew, familyKey)).toBe(true);
      const personalWrap = await admin
        .from('personal_key_wraps')
        .select('wrapped_key')
        .eq('device_id', newDeviceId)
        .maybeSingle();
      if (personalWrap.error || !personalWrap.data) {
        throw personalWrap.error ?? new Error('personal wrap missing after A+B finish');
      }
      const openedPersonal = unwrapPersonalKeyFromDevice(
        fromPgBytea(personalWrap.data.wrapped_key),
        newDevice.privateKey,
        { familySpaceId: spaceId, userId: adminId, deviceId: newDeviceId },
      );
      expect(secretsEqual(openedPersonal, personalKey)).toBe(true);
      wipe(openedNew);
      wipe(openedPersonal);
      wipe(familyKey);
      wipe(personalKey);
      wipe(secretA);
      wipe(secretB);
      wipe(recoveryPair.privateKey);
      await admin.auth.signOut();
      await elderA.auth.signOut();
      await elderB.auth.signOut();
    },
    45000,
  );

  it(
    'repairs legacy zero pair boxes then finishes A+B on the new epoch',
    async () => {
      if (!(await localReady())) {
        throw new Error('local Supabase at 127.0.0.1:54321 is required');
      }
      const service = serviceClient();
      service.auth.stopAutoRefresh();
      const password = 'Api-repair-12';
      const stamp = Date.now();
      const adminAuth = await service.auth.admin.createUser({
        email: `admin-rp-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderAAuth = await service.auth.admin.createUser({
        email: `elder-ra-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      const elderBAuth = await service.auth.admin.createUser({
        email: `elder-rb-${stamp}@patria.local`,
        password,
        email_confirm: true,
      });
      if (
        adminAuth.error ||
        elderAAuth.error ||
        elderBAuth.error ||
        !adminAuth.data.user ||
        !elderAAuth.data.user ||
        !elderBAuth.data.user
      ) {
        throw (
          adminAuth.error ??
          elderAAuth.error ??
          elderBAuth.error ??
          new Error('createUser failed')
        );
      }
      const admin = userClient();
      const elderA = userClient();
      const elderB = userClient();
      await admin.auth.signInWithPassword({
        email: `admin-rp-${stamp}@patria.local`,
        password,
      });
      await elderA.auth.signInWithPassword({
        email: `elder-ra-${stamp}@patria.local`,
        password,
      });
      await elderB.auth.signInWithPassword({
        email: `elder-rb-${stamp}@patria.local`,
        password,
      });
      admin.auth.stopAutoRefresh();
      elderA.auth.stopAutoRefresh();
      elderB.auth.stopAutoRefresh();
      setActiveClient(admin);
      const adminId = adminAuth.data.user.id;
      const elderAId = elderAAuth.data.user.id;
      const elderBId = elderBAuth.data.user.id;
      const space = await admin.rpc('create_family_space', {
        p_name: `Repair ${stamp}`,
        p_relationship_label: 'Mom',
      });
      if (space.error || !space.data) {
        throw space.error ?? new Error('create_family_space failed');
      }
      const spaceId = String(space.data);
      for (const [id, role] of [
        [elderAId, 'elder'],
        [elderBId, 'elder'],
      ] as const) {
        const added = await service.from('space_members').insert({
          family_space_id: spaceId,
          user_id: id,
          role,
        });
        if (added.error) {
          throw added.error;
        }
      }
      const oldDevice = generateDeviceKeyPair();
      const newDevice = generateDeviceKeyPair();
      const contactADevice = generateDeviceKeyPair();
      const contactBDevice = generateDeviceKeyPair();
      const oldDeviceId = randomUuid();
      const newDeviceId = randomUuid();
      const contactADeviceId = randomUuid();
      const contactBDeviceId = randomUuid();
      const familyKey = randomKey32();
      const personalKey = randomKey32();
      const staleRecovery = generateDeviceKeyPair();
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
      for (const row of [
        { userId: elderAId, deviceId: contactADeviceId, pub: contactADevice.publicKey },
        { userId: elderBId, deviceId: contactBDeviceId, pub: contactBDevice.publicKey },
      ]) {
        const dk = await service.from('device_keys').insert({
          user_id: row.userId,
          device_id: row.deviceId,
          public_key: toPgBytea(row.pub),
        });
        if (dk.error) {
          throw dk.error;
        }
        const wrap = await admin.from('family_key_wraps').insert({
          family_space_id: spaceId,
          user_id: row.userId,
          device_id: row.deviceId,
          wrapped_key: toPgBytea(
            wrapKeyToDevice(familyKey, row.pub, {
              familySpaceId: spaceId,
              keyEpoch: 1,
              userId: row.userId,
              deviceId: row.deviceId,
            }),
          ),
          key_epoch: 1,
          approved_by: adminId,
        });
        if (wrap.error) {
          throw wrap.error;
        }
      }
      for (const [userId, client, slot] of [
        [elderAId, elderA, 'a'],
        [elderBId, elderB, 'b'],
      ] as const) {
        const invite = await admin.from('recovery_contacts').insert({
          family_space_id: spaceId,
          member_id: adminId,
          user_id: userId,
          slot,
          created_by: adminId,
        });
        if (invite.error) {
          throw invite.error;
        }
        const accept = await client
          .from('recovery_contacts')
          .update({ status: 'accepted' })
          .eq('family_space_id', spaceId)
          .eq('user_id', userId);
        if (accept.error) {
          throw accept.error;
        }
      }
      // Legacy broken shape: public key + contacts, zero pair boxes.
      const pub = await admin.from('recovery_public_keys').insert({
        family_space_id: spaceId,
        user_id: adminId,
        public_key: toPgBytea(staleRecovery.publicKey),
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
          wrapFamilyKeyToRecoveryPublic(familyKey, staleRecovery.publicKey, {
            familySpaceId: spaceId,
            keyEpoch: 1,
            userId: adminId,
          }),
        ),
      });
      if (sealed.error) {
        throw sealed.error;
      }
      const personalSeal = await service.from('personal_key_under_recovery').insert({
        family_space_id: spaceId,
        user_id: adminId,
        wrapped_key: toPgBytea(
          wrapPersonalKeyToRecovery(personalKey, staleRecovery.publicKey, spaceId, adminId),
        ),
      });
      if (personalSeal.error) {
        throw personalSeal.error;
      }
      const personalDeviceWrap = await service.from('personal_key_wraps').insert({
        family_space_id: spaceId,
        user_id: adminId,
        device_id: oldDeviceId,
        wrapped_key: toPgBytea(
          wrapPersonalKeyToDevice(personalKey, oldDevice.publicKey, {
            familySpaceId: spaceId,
            userId: adminId,
            deviceId: oldDeviceId,
          }),
        ),
      });
      if (personalDeviceWrap.error) {
        throw personalDeviceWrap.error;
      }
      // Contact devices exist but no usable holder secrets / pair boxes yet.
      const pairCount = await admin
        .from('recovery_pair_wraps')
        .select('pair_id', { count: 'exact', head: true })
        .eq('family_space_id', spaceId)
        .eq('user_id', adminId);
      expect(pairCount.count ?? 0).toBe(0);

      await installDeviceIdentity(adminId, oldDeviceId, oldDevice.privateKey);
      await cacheFamilySecrets(adminId, spaceId, familyKey);
      await cachePersonalKey(adminId, spaceId, personalKey);
      setActiveClient(admin);
      await repairRecoverySetup(
        { spaceId, memberUserId: adminId },
        supabaseRecoveryAccessGateway,
      );

      const epochRow = await admin
        .from('recovery_public_keys')
        .select('recovery_key_epoch')
        .eq('family_space_id', spaceId)
        .eq('user_id', adminId)
        .maybeSingle();
      expect(epochRow.data?.recovery_key_epoch).toBe(2);
      const abRows = await admin
        .from('recovery_pair_wraps')
        .select('pair_id')
        .eq('family_space_id', spaceId)
        .eq('user_id', adminId)
        .eq('recovery_key_epoch', 2);
      expect((abRows.data ?? []).map((row) => row.pair_id)).toEqual(['ab']);

      // Lost phone after repair.
      await installDeviceIdentity(adminId, newDeviceId, newDevice.privateKey);
      const recoveredGate = gatewayFor(admin);
      const requestId = await recoveredGate.startRequest(
        spaceId,
        newDeviceId,
        newDevice.publicKey,
      );
      await advanceWait(service, requestId);
      const listed = await recoveredGate.listRequests(spaceId);
      const request = listed.find((row) => row.id === requestId);
      if (!request) {
        throw new Error('missing recovery request after repair');
      }
      await approveRecoveryAsContact(
        {
          spaceId,
          request,
          slot: 'a',
          contactUserId: elderAId,
          contactDeviceId: contactADeviceId,
          contactPrivateKey: contactADevice.privateKey,
        },
        gatewayFor(elderA),
      );
      await approveRecoveryAsContact(
        {
          spaceId,
          request,
          slot: 'b',
          contactUserId: elderBId,
          contactDeviceId: contactBDeviceId,
          contactPrivateKey: contactBDevice.privateKey,
        },
        gatewayFor(elderB),
      );
      setActiveClient(admin);
      await finishLostPhoneRecovery(
        {
          spaceId,
          userId: adminId,
          role: 'family_admin',
          deviceId: newDeviceId,
          privateKey: newDevice.privateKey,
          publicKey: newDevice.publicKey,
          request,
          paperWords: '',
        },
        recoveredGate,
      );

      const newWrap = await admin
        .from('family_key_wraps')
        .select('wrapped_key, key_epoch')
        .eq('device_id', newDeviceId)
        .maybeSingle();
      if (newWrap.error || !newWrap.data) {
        throw newWrap.error ?? new Error('new wrap missing after repair recovery');
      }
      const openedNew = unwrapKeyFromDevice(
        fromPgBytea(newWrap.data.wrapped_key),
        newDevice.privateKey,
        {
          familySpaceId: spaceId,
          keyEpoch: newWrap.data.key_epoch as number,
          userId: adminId,
          deviceId: newDeviceId,
        },
      );
      expect(secretsEqual(openedNew, familyKey)).toBe(true);
      const personalWrap = await admin
        .from('personal_key_wraps')
        .select('wrapped_key')
        .eq('device_id', newDeviceId)
        .maybeSingle();
      if (personalWrap.error || !personalWrap.data) {
        throw personalWrap.error ?? new Error('personal wrap missing after repair recovery');
      }
      const openedPersonal = unwrapPersonalKeyFromDevice(
        fromPgBytea(personalWrap.data.wrapped_key),
        newDevice.privateKey,
        { familySpaceId: spaceId, userId: adminId, deviceId: newDeviceId },
      );
      expect(secretsEqual(openedPersonal, personalKey)).toBe(true);
      wipe(openedNew);
      wipe(openedPersonal);
      wipe(familyKey);
      wipe(personalKey);
      wipe(staleRecovery.privateKey);
      await admin.auth.signOut();
      await elderA.auth.signOut();
      await elderB.auth.signOut();
    },
    60000,
  );
});
