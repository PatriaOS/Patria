// SECURITY REVIEW REQUIRED
// letter-release: after a letter's trigger time, opens the Patria half of its key
// (shareP) and returns it to the signed-in recipient only. The recipient combines it
// with the half their own phone holds. Patria never sees the letter.
//
// Logs carry the letter id and a safe reason code, never content, keys, shares,
// names, or full AWS error bodies.
import { createClient } from '@supabase/supabase-js';

import { deriveSharedSecretWithKms } from './kms.ts';
import { resolveLetterReleaseKmsKeyId } from './kmsEnv.ts';
import {
  classifyLetterReleaseClaimError,
  classifyLetterReleaseOpenError,
  clientLetterReleaseClaimError,
  decideReleaseKey,
  decodePgBytea,
  openShareWithKmsSecret,
  openSharePLocal,
  shareToHex,
  type LetterReleaseReasonCode,
} from './release.ts';

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, error: LetterReleaseReasonCode): Response {
  // Reason code only — never keyId, AWS bodies, keys, shares, or letter content.
  console.error('letter-release', error);
  return new Response(JSON.stringify({ error }), { status, headers: HEADERS });
}

function replyWithLetter(status: number, error: LetterReleaseReasonCode, letterId: string): Response {
  console.error('letter-release', error, letterId);
  return new Response(JSON.stringify({ error }), { status, headers: HEADERS });
}

function replyOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: HEADERS });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return reply(405, 'method');
  }

  // 1. Which key may open Patria's half here? Hosted refuses the fake key outright.
  // Validate LETTER_RELEASE_KMS_KEY_ID shape before AWS (never log the raw secret).
  const kmsResolved = resolveLetterReleaseKmsKeyId(Deno.env.get('LETTER_RELEASE_KMS_KEY_ID'));
  const decision = decideReleaseKey({
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    deploymentId: Deno.env.get('DENO_DEPLOYMENT_ID'),
    privateKeyHex: Deno.env.get('LETTER_RELEASE_PRIVATE_KEY_HEX'),
    kmsKeyId: kmsResolved.status === 'ok' ? kmsResolved.keyId : undefined,
    kmsKeyInvalid: kmsResolved.status === 'invalid',
  });
  if (decision.kind === 'refuse_fake_key_on_hosted') {
    return reply(503, 'hosted_refuse_fake_key');
  }
  if (decision.kind === 'kms_not_configured') {
    return reply(503, 'kms_not_configured');
  }
  if (decision.kind === 'env_invalid') {
    return reply(503, 'env_invalid');
  }
  if (decision.kind === 'local_key_missing') {
    return reply(500, 'release_key_missing');
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
    return reply(401, 'unauthorized');
  }

  let letterId = '';
  try {
    const body = await req.json();
    letterId = typeof body?.letter_id === 'string' ? body.letter_id : '';
  } catch {
    return reply(400, 'bad_body');
  }
  if (!UUID.test(letterId)) {
    return reply(400, 'letter_id_required');
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
    const detail = classifyLetterReleaseClaimError(
      claimError.code,
      typeof claimError.message === 'string' ? claimError.message : undefined,
    );
    // Log the precise reason; client body is only not_due or not_allowed.
    console.error('letter-release', detail, letterId);
    return new Response(JSON.stringify({ error: clientLetterReleaseClaimError(detail) }), {
      status: 403,
      headers: HEADERS,
    });
  }
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!row?.ephemeral_public || !row?.sealed_share) {
    console.error('letter-release', 'not_found', letterId);
    return new Response(JSON.stringify({ error: 'not_allowed' }), {
      status: 403,
      headers: HEADERS,
    });
  }

  // 4. Open shareP in memory and hand it to the recipient.
  let shareP: Uint8Array | undefined;
  try {
    const ephemeralPublic = decodePgBytea(row.ephemeral_public);
    const sealedShare = decodePgBytea(row.sealed_share);
    const version = Number(row.version);
    if (decision.kind === 'kms') {
      let sharedSecret: Uint8Array;
      try {
        sharedSecret = await deriveSharedSecretWithKms(decision.keyId, ephemeralPublic);
      } catch (error) {
        // Classify then discard the AWS error — never log message, keyId, or body.
        const reason = classifyLetterReleaseOpenError(error);
        return replyWithLetter(
          reason === 'env_missing' || reason === 'env_invalid' ? 503 : 500,
          reason,
          letterId,
        );
      }
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
      return replyWithLetter(403, 'mark_failed', letterId);
    }

    console.log('letter-release ok', letterId);
    return replyOk({ share_p_hex: shareToHex(shareP) });
  } catch (error) {
    const reason = classifyLetterReleaseOpenError(error);
    return replyWithLetter(500, reason, letterId);
  } finally {
    shareP?.fill(0);
  }
});
