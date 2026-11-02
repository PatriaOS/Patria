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
  if (value) {
    return releasePublicKeyFromHex(value);
  }
  // Local / phone e2e: Metro often starts with EXPO_NO_DOTENV and may omit this
  // public key from .env.e2e.local. The documented fake key is safe on device;
  // hosted Edge refuses it by fingerprint. Never fall back in production builds.
  const allowFake =
    process.env.EXPO_PUBLIC_E2E === '1' ||
    (typeof __DEV__ !== 'undefined' && __DEV__ === true);
  if (allowFake) {
    return releasePublicKeyFromHex(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX);
  }
  throw new Error('letter release key missing');
}
