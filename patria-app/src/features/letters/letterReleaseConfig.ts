// SECURITY REVIEW REQUIRED
import { releasePublicKeyFromHex } from '../../lib/crypto/letterReleaseKey';
import { FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX as EDGE_FAKE_PUBLIC } from '../../../supabase/functions/letter-release/release';

/**
 * Fixed FAKE compressed P-256 public key for local runs and tests. The matching
 * private key lives only in `.env.example` as LETTER_RELEASE_PRIVATE_KEY_HEX
 * (Edge Function env, local only). Hosted refuses it by public-key fingerprint.
 */
export const FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX = EDGE_FAKE_PUBLIC;

export function getLetterReleasePublicKey(
  hex: string | undefined = process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX,
): Uint8Array {
  const value = hex?.trim();
  if (!value) {
    throw new Error('letter release key missing');
  }
  return releasePublicKeyFromHex(value);
}
