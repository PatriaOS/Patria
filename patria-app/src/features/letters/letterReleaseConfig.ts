// SECURITY REVIEW REQUIRED
import { releasePublicKeyFromHex } from '../../lib/crypto/letterReleaseKey';
import { isLocalOrE2eRuntime } from '../../lib/localOrE2eRuntime';
import { FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX as EDGE_FAKE_PUBLIC } from '../../../supabase/functions/letter-release/release';

/**
 * Fixed FAKE compressed P-256 public key for local runs and tests. The matching
 * private key lives only in `.env.example` as LETTER_RELEASE_PRIVATE_KEY_HEX
 * (Edge Function env, local only). Hosted refuses it by public-key fingerprint.
 */
export const FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX = EDGE_FAKE_PUBLIC;

/**
 * Fake / missing release keys are only for a local Supabase stack or e2e.
 * Expo Go sets __DEV__ true even against hosted — never treat __DEV__ alone as
 * permission to seal with the fake key.
 */
export function allowFakeLetterReleaseKey(
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): boolean {
  return isLocalOrE2eRuntime(supabaseUrl);
}

/** True when the hex is the known local/CI fake public key (case-insensitive). */
export function isFakeLetterReleasePublicKeyHex(hex: string | undefined): boolean {
  const value = hex?.trim().toLowerCase();
  return Boolean(value) && value === FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX.toLowerCase();
}

/**
 * Hosted must not seal until a real (non-fake) release public key is configured.
 * Local stacks and e2e may use the fake key; Expo Go against hosted must not.
 */
export function letterReleaseReadyForSealing(
  hex: string | undefined = process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX,
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): boolean {
  const value = hex?.trim();
  const allowFake = allowFakeLetterReleaseKey(supabaseUrl);
  if (!value) {
    return allowFake;
  }
  if (isFakeLetterReleasePublicKeyHex(value)) {
    return allowFake;
  }
  try {
    releasePublicKeyFromHex(value);
    return true;
  } catch {
    return false;
  }
}

export function getLetterReleasePublicKey(
  hex: string | undefined = process.env.EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX,
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): Uint8Array {
  const value = hex?.trim();
  const allowFake = allowFakeLetterReleaseKey(supabaseUrl);

  if (value) {
    if (isFakeLetterReleasePublicKeyHex(value) && !allowFake) {
      throw new Error('letter release key not configured for hosted');
    }
    return releasePublicKeyFromHex(value);
  }

  // Local / phone e2e: Metro often starts with EXPO_NO_DOTENV and may omit this
  // public key from .env.e2e.local. The documented fake key is safe on a local
  // stack; hosted Edge refuses it by fingerprint. Never fall back on hosted.
  if (allowFake) {
    return releasePublicKeyFromHex(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX);
  }
  throw new Error('letter release key missing');
}
