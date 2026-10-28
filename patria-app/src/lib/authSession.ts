import { clearRecoveryReminderSession } from '../features/family/recoveryReminderSession';
import { routes } from './navigation';

export async function signOutAndGoWelcome(input: {
  userId?: string;
  signOut: () => Promise<unknown>;
  replace: (href: string) => void;
}): Promise<void> {
  // Every sign-out path must reset the one-shot reminder so the next sign-in
  // can offer it again (including the AsyncStorage marker).
  await clearRecoveryReminderSession(input.userId);
  await input.signOut();
  input.replace(routes.welcome);
}
