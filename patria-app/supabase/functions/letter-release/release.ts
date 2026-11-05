// SECURITY REVIEW REQUIRED
//
// Pure helpers for the letter-release Edge Function. No network, no Deno APIs,
// so the same file runs under Deno (npm: import map) and under Jest, where a
// parity test proves it opens exactly what the app seals.
//
// This mirrors src/lib/crypto/letterReleaseKey.ts (openSharePWithReleasePrivateKey).
// It only composes audited @noble primitives: P-256 ECDH, HKDF-SHA256, XChaCha20-Poly1305.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const SHARE_INFO_PREFIX = 'patria/letter-patria-share/v1';
const AEAD_VERSION = 1;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const P256_COMPRESSED_PUBLIC_BYTES = 33;

/** Fixed local/CI fake compressed P-256 public key (must match app .env.example). */
export const FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX =
  '03ca1057fffbed5969b9619fc60d57877b24f95dbeb0844593b417d3cdeeeedc56';

export function releasePublicKeyFingerprint(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey));
}

export const FAKE_LETTER_RELEASE_PUBLIC_KEY_FINGERPRINT = releasePublicKeyFingerprint(
  hexToBytes(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX),
);

/** True when this private key belongs to the known local fake pair. */
export function isFakeReleasePrivateKey(privateKeyHex: string): boolean {
  try {
    const privateKey = hexToBytes(privateKeyHex.trim());
    if (privateKey.length !== KEY_BYTES) {
      return false;
    }
    const publicKey = p256.getPublicKey(privateKey, true);
    return (
      releasePublicKeyFingerprint(publicKey) === FAKE_LETTER_RELEASE_PUBLIC_KEY_FINGERPRINT
    );
  } catch {
    return false;
  }
}

/** Hosts the local `supabase functions serve` runtime reports as SUPABASE_URL. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal', 'kong']);

export type ReleaseEnv = {
  supabaseUrl: string | undefined;
  /** Set by the hosted Edge runtime; never set by local `functions serve`. */
  deploymentId: string | undefined;
  privateKeyHex: string | undefined;
  /** AWS KMS key id (ECC_NIST_P256, KEY_AGREEMENT). Hosted only. */
  kmsKeyId?: string | undefined;
};

/**
 * True unless we can positively tell this is a local stack. Fails closed: an
 * unknown or unparsable URL counts as hosted.
 */
export function isHosted(env: Pick<ReleaseEnv, 'supabaseUrl' | 'deploymentId'>): boolean {
  if (env.deploymentId && env.deploymentId.trim() !== '') {
    return true;
  }
  const raw = env.supabaseUrl?.trim();
  if (!raw) {
    return true;
  }
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (LOCAL_HOSTS.has(host) || host.startsWith('supabase_kong')) {
    return false;
  }
  return true;
}

export type ReleaseKeyDecision =
  | { kind: 'local'; privateKey: Uint8Array }
  | { kind: 'kms'; keyId: string }
  | { kind: 'refuse_fake_key_on_hosted' }
  | { kind: 'kms_not_configured' }
  | { kind: 'env_invalid' }
  | { kind: 'local_key_missing' };

/**
 * Decide which key may open Patria's half.
 * - Hosted: refuse the known fake key by public-key fingerprint (not merely "env is set").
 *   Never use an env private key on hosted; only AWS KMS DeriveSharedSecret.
 *   Pass kmsKeyId already parsed by parseLetterReleaseKmsKeyId (see kmsEnv), or set
 *   kmsKeyInvalid when the raw secret was present but not a UUID/ARN/alias.
 * - Local: the fake private key from supabase/functions/.env.
 */
export function decideReleaseKey(
  env: ReleaseEnv & { kmsKeyInvalid?: boolean },
): ReleaseKeyDecision {
  const hex = env.privateKeyHex?.trim();
  if (isHosted(env)) {
    if (hex && isFakeReleasePrivateKey(hex)) {
      return { kind: 'refuse_fake_key_on_hosted' };
    }
    if (env.kmsKeyInvalid) {
      return { kind: 'env_invalid' };
    }
    const keyId = env.kmsKeyId?.trim() ?? '';
    return keyId ? { kind: 'kms', keyId } : { kind: 'kms_not_configured' };
  }
  if (!hex) {
    return { kind: 'local_key_missing' };
  }
  const privateKey = hexToBytes(hex);
  if (privateKey.length !== KEY_BYTES) {
    return { kind: 'local_key_missing' };
  }
  return { kind: 'local', privateKey };
}

/** PostgREST returns bytea as `\x…` hex text. */
export function decodePgBytea(value: unknown): Uint8Array {
  if (typeof value !== 'string') {
    throw new Error('invalid bytea');
  }
  const hex = value.startsWith('\\x') || value.startsWith('\\X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('invalid bytea');
  }
  return hexToBytes(hex);
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function utf8Prefixed(value: string): Uint8Array {
  const bytes = utf8ToBytes(value);
  if (bytes.length > 0xffff) {
    throw new Error('invalid length');
  }
  return concatBytes(new Uint8Array([(bytes.length >> 8) & 0xff, bytes.length & 0xff]), bytes);
}

function shareInfo(letterId: string, version: number): Uint8Array {
  return concatBytes(utf8ToBytes(SHARE_INFO_PREFIX), utf8Prefixed(letterId), u32be(version));
}

/** Opens shareP with the local fake release private key. Throws 'unwrap failed' on any mismatch. */
export function openSharePLocal(input: {
  privateKey: Uint8Array;
  ephemeralPublic: Uint8Array;
  sealedShare: Uint8Array;
  letterId: string;
  version: number;
}): Uint8Array {
  if (input.ephemeralPublic.length !== P256_COMPRESSED_PUBLIC_BYTES) {
    throw new Error('unwrap failed');
  }
  if (
    input.sealedShare.length < 1 + NONCE_BYTES + TAG_BYTES ||
    input.sealedShare[0] !== AEAD_VERSION
  ) {
    throw new Error('unwrap failed');
  }
  const info = shareInfo(input.letterId, input.version);
  let shared: Uint8Array | undefined;
  let wrapKey: Uint8Array | undefined;
  try {
    shared = p256.getSharedSecret(input.privateKey, input.ephemeralPublic);
    // Compressed point: drop the format byte to get the raw x-coordinate (what KMS returns).
    const raw = shared.subarray(1, 1 + KEY_BYTES);
    wrapKey = hkdf(sha256, raw, new Uint8Array(0), info, KEY_BYTES);
    const nonce = input.sealedShare.subarray(1, 1 + NONCE_BYTES);
    const body = input.sealedShare.subarray(1 + NONCE_BYTES);
    return xchacha20poly1305(wrapKey, nonce, info).decrypt(body);
  } catch {
    throw new Error('unwrap failed');
  } finally {
    shared?.fill(0);
    wrapKey?.fill(0);
  }
}

export function shareToHex(share: Uint8Array): string {
  return bytesToHex(share);
}

/** Safe Edge/app reason codes — never include keys, shares, content, keyIds, or raw AWS bodies. */
export type LetterReleaseReasonCode =
  | 'method'
  | 'hosted_refuse_fake_key'
  | 'kms_not_configured'
  | 'env_missing'
  | 'env_invalid'
  | 'release_key_missing'
  | 'unauthorized'
  | 'bad_body'
  | 'letter_id_required'
  | 'not_found'
  | 'not_recipient'
  | 'not_due'
  | 'recipient_left'
  | 'bad_status'
  | 'claim_refused'
  | 'bad_share'
  | 'kms_denied'
  | 'kms_not_found'
  | 'kms_error'
  | 'unwrap_failed'
  | 'mark_failed'
  | 'open_failed'
  | 'invoke_failed';

/**
 * Map a caught open/KMS failure to a safe reason code.
 * Uses only short name/message fragments — never log the full AWS error body or keyId.
 */
export function classifyLetterReleaseOpenError(error: unknown): LetterReleaseReasonCode {
  if (!(error instanceof Error)) {
    return 'open_failed';
  }
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  if (message.includes('credentials missing')) {
    return 'env_missing';
  }
  // Prefer exception name so we never need to echo AWS's "Invalid keyId …" text.
  if (name.includes('notfound') || message.includes('invalid keyid')) {
    return 'kms_not_found';
  }
  if (
    name.includes('accessdenied') ||
    message.includes('accessdenied') ||
    message.includes('access denied') ||
    message.includes('not authorized') ||
    message.includes('unauthorizedoperation') ||
    (message.includes('kms') && message.includes('denied'))
  ) {
    return 'kms_denied';
  }
  if (message === 'unwrap failed') {
    return 'unwrap_failed';
  }
  if (
    message.includes('invalid public key') ||
    message.includes('invalid bytea') ||
    message.includes('invalid shared secret')
  ) {
    return 'bad_share';
  }
  if (
    name.includes('kms') ||
    message.includes('kms') ||
    message.includes('shared secret') ||
    message.includes('derive')
  ) {
    return 'kms_error';
  }
  return 'open_failed';
}

/**
 * Classify claim_letter_patria_share failures from SQL exception messages
 * (not_recipient / not_due / recipient_left / bad_status).
 */
export function classifyLetterReleaseClaimError(
  code: string | undefined,
  message: string | undefined,
): LetterReleaseReasonCode {
  if (code === 'P0002') {
    return 'not_found';
  }
  const lower = (message ?? '').toLowerCase();
  if (lower.includes('not found')) {
    return 'not_found';
  }
  if (lower.includes('not_recipient')) {
    return 'not_recipient';
  }
  if (lower.includes('recipient_left')) {
    return 'recipient_left';
  }
  if (lower.includes('not_due')) {
    return 'not_due';
  }
  if (lower.includes('bad_status')) {
    return 'bad_status';
  }
  return 'claim_refused';
}

// ASN.1 SubjectPublicKeyInfo header for an uncompressed prime256v1 point (65 bytes follow).
const P256_SPKI_PREFIX = hexToBytes('3059301306072a8648ce3d020106082a8648ce3d030107034200');

/** DER SubjectPublicKeyInfo of a compressed P-256 point: the form KMS DeriveSharedSecret wants. */
export function ephemeralPublicKeyToSpki(compressed: Uint8Array): Uint8Array {
  if (compressed.length !== P256_COMPRESSED_PUBLIC_BYTES) {
    throw new Error('invalid public key');
  }
  return concatBytes(P256_SPKI_PREFIX, p256.Point.fromBytes(compressed).toBytes(false));
}

/**
 * Opens shareP from a KMS DeriveSharedSecret result (the raw 32 byte x-coordinate).
 * Same HKDF info, AAD and sealed layout as openSharePLocal.
 */
export function openShareWithKmsSecret(input: {
  sharedSecret: Uint8Array;
  sealedShare: Uint8Array;
  letterId: string;
  version: number;
}): Uint8Array {
  if (input.sharedSecret.length !== KEY_BYTES) {
    throw new Error('unwrap failed');
  }
  if (
    input.sealedShare.length < 1 + NONCE_BYTES + TAG_BYTES ||
    input.sealedShare[0] !== AEAD_VERSION
  ) {
    throw new Error('unwrap failed');
  }
  const info = shareInfo(input.letterId, input.version);
  let wrapKey: Uint8Array | undefined;
  try {
    wrapKey = hkdf(sha256, input.sharedSecret, new Uint8Array(0), info, KEY_BYTES);
    const nonce = input.sealedShare.subarray(1, 1 + NONCE_BYTES);
    const body = input.sealedShare.subarray(1 + NONCE_BYTES);
    return xchacha20poly1305(wrapKey, nonce, info).decrypt(body);
  } catch {
    throw new Error('unwrap failed');
  } finally {
    wrapKey?.fill(0);
  }
}
