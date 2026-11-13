import { clearRecoveryReminderSession } from '../features/family/recoveryReminderSession';
import { clearRecoveryPrivateSecret } from './crypto/recoverySetup';
import { routes } from './navigation';

export async function signOutAndGoWelcome(input: {
  userId?: string;
  spaceId?: string;
  signOut: () => Promise<unknown>;
  replace: (href: string) => void;
}): Promise<void> {
  // Every sign-out path must reset the one-shot reminder so the next sign-in
  // can offer it again (including the AsyncStorage marker).
  await clearRecoveryReminderSession(input.userId);
  // Temporary recovery private must not survive sign-out (only kept until ab).
  if (input.userId && input.spaceId) {
    await clearRecoveryPrivateSecret(input.userId, input.spaceId);
  }
  await input.signOut();
  input.replace(routes.welcome);
}
