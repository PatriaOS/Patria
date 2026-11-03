import { isHosted } from '../../supabase/functions/letter-release/release';

/**
 * True for a local Supabase stack or phone e2e. Expo Go sets __DEV__ even against
 * hosted — never treat __DEV__ alone as permission for fake keys, fake providers,
 * sample media, or design/test shortcuts.
 */
export function isLocalOrE2eRuntime(
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): boolean {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return true;
  }
  return !isHosted({ supabaseUrl, deploymentId: undefined });
}
