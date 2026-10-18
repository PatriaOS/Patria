// SECURITY REVIEW REQUIRED
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { randomKey32 } from '../../lib/crypto/random';
import { supabase } from '../../lib/supabase';

function asSecret(value: unknown): Uint8Array | null {
  if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length === 64) {
    return hexToBytes(value);
  }
  if (typeof value === 'string' && value.startsWith('\\x') && value.length === 66) {
    return hexToBytes(value.slice(2));
  }
  if (value instanceof Uint8Array && value.byteLength === 32) {
    return value;
  }
  return null;
}

export async function fetchSourceKey(userId: string): Promise<Uint8Array | null> {
  const existing = await supabase
    .from('memory_source_keys')
    .select('secret')
    .eq('user_id', userId)
    .maybeSingle();
  return asSecret(existing.data?.secret);
}

export async function getOrCreateSourceKey(userId: string): Promise<Uint8Array> {
  const rpc = await supabase.rpc('get_or_create_memory_source_key');
  const fromRpc = asSecret(rpc.data);
  if (fromRpc) {
    return fromRpc;
  }
  const existing = await fetchSourceKey(userId);
  if (existing) {
    return existing;
  }
  const secret = randomKey32();
  const inserted = await supabase.from('memory_source_keys').insert({
    user_id: userId,
    secret: `\\x${bytesToHex(secret)}`,
  });
  if (!inserted.error) {
    return secret;
  }
  const again = await fetchSourceKey(userId);
  if (again) {
    return again;
  }
  throw inserted.error ?? rpc.error ?? new Error('source-key');
}
