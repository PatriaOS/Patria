import { isHosted } from '../../supabase/functions/letter-release/release';

/**
 * True for a local Supabase stack or phone e2e. Expo Go sets __DEV__ even against
 * hosted — never treat __DEV__ alone as permission for fake keys, fake providers,
 * or sample media. Prefer {@link isDesignPreviewRuntime} for design routes.
 */
export function isLocalOrE2eRuntime(
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): boolean {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return true;
  }
  return !isHosted({ supabaseUrl, deploymentId: undefined });
}

/**
 * Design preview routes (home/gallery/sync/recovery). Local Supabase URL only —
 * never hosted, even when EXPO_PUBLIC_E2E=1 (e2e always uses a local URL).
 */
export function isDesignPreviewRuntime(
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): boolean {
  return !isHosted({ supabaseUrl, deploymentId: undefined });
}
