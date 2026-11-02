// SECURITY REVIEW REQUIRED
// letter-release: after a letter's trigger time, opens the Patria half of its key
// (shareP) and returns it to the signed-in recipient only. The recipient combines it
// with the half their own phone holds. Patria never sees the letter.
//
// Logs carry the letter id and an error name, never content, keys or names.
import { createClient } from '@supabase/supabase-js';

import { deriveSharedSecretWithKms } from './kms.ts';
import {
  decideReleaseKey,
  decodePgBytea,
  openShareWithKmsSecret,
  openSharePLocal,
  shareToHex,
} from './release.ts';

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return reply(405, { error: 'method' });
  }

  // 1. Which key may open Patria's half here? Hosted refuses the fake key outright.
  const decision = decideReleaseKey({
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    deploymentId: Deno.env.get('DENO_DEPLOYMENT_ID'),
    privateKeyHex: Deno.env.get('LETTER_RELEASE_PRIVATE_KEY_HEX'),
    kmsKeyId: Deno.env.get('LETTER_RELEASE_KMS_KEY_ID'),
  });
  if (decision.kind === 'refuse_fake_key_on_hosted') {
    console.error('letter-release: refusing fake release key on hosted');
    return reply(503, { error: 'hosted_refuse_fake_key' });
  }
  if (decision.kind === 'kms_not_configured') {
    console.error('letter-release: KMS not configured');
    return reply(503, { error: 'kms_not_configured' });
  }
  if (decision.kind === 'local_key_missing') {
    return reply(500, { error: 'release_key_missing' });
  }

  // 2. Who is asking? (verify_jwt already checked the signature; this names the user.)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return reply(401, { error: 'unauthorized' });
  }

  let letterId = '';
  try {
    const body = await req.json();
    letterId = typeof body?.letter_id === 'string' ? body.letter_id : '';
  } catch {
    return reply(400, { error: 'bad_body' });
  }
  if (!UUID.test(letterId)) {
    return reply(400, { error: 'letter_id_required' });
  }

  // 3. Only the letter's recipient, only after trigger_at, only if they have not left.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimed, error: claimError } = await admin.rpc('claim_letter_patria_share', {
    p_letter_id: letterId,
    p_recipient_id: user.id,
  });
  if (claimError) {
    console.error('letter-release claim refused', letterId, claimError.code ?? 'unknown');
    return reply(claimError.code === 'P0002' ? 404 : 403, { error: 'not_allowed' });
  }
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!row?.ephemeral_public || !row?.sealed_share) {
    return reply(404, { error: 'not_found' });
  }

  // 4. Open shareP in memory and hand it to the recipient.
  let shareP: Uint8Array | undefined;
  try {
    const ephemeralPublic = decodePgBytea(row.ephemeral_public);
    const sealedShare = decodePgBytea(row.sealed_share);
    const version = Number(row.version);
    if (decision.kind === 'kms') {
      const sharedSecret = await deriveSharedSecretWithKms(decision.keyId, ephemeralPublic);
      try {
        shareP = openShareWithKmsSecret({ sharedSecret, sealedShare, letterId, version });
      } finally {
        sharedSecret.fill(0);
      }
    } else {
      shareP = openSharePLocal({
        privateKey: decision.privateKey,
        ephemeralPublic,
        sealedShare,
        letterId,
        version,
      });
    }

    const { error: markError } = await admin.rpc('mark_letter_released', {
      p_letter_id: letterId,
      p_recipient_id: user.id,
    });
    if (markError) {
      console.error('letter-release mark failed', letterId, markError.code ?? 'unknown');
      return reply(403, { error: 'not_allowed' });
    }

    console.log('letter-release ok', letterId);
    return reply(200, { share_p_hex: shareToHex(shareP) });
  } catch (error) {
    console.error(
      'letter-release open failed',
      letterId,
      error instanceof Error ? error.message : 'unknown',
    );
    return reply(500, { error: 'open_failed' });
  } finally {
    shareP?.fill(0);
  }
});
