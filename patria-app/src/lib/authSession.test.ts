import {
  markRecoveryReminderShownThisSession,
  recoveryReminderShownThisSession,
  clearRecoveryReminderSession,
} from '../features/family/recoveryReminderSession';
import { signOutAndGoWelcome } from './authSession';
import { routes } from './navigation';

describe('signOutAndGoWelcome', () => {
  beforeEach(() => {
    clearRecoveryReminderSession();
  });

  it('signs out then replaces to welcome', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    const replace = jest.fn();

    await signOutAndGoWelcome({ signOut, replace });

    expect(signOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(routes.welcome);
    expect(replace.mock.invocationCallOrder[0]).toBeGreaterThan(
      signOut.mock.invocationCallOrder[0],
    );
  });

  it('clears the recovery reminder session so the next sign-in can offer it', async () => {
    markRecoveryReminderShownThisSession();
    expect(recoveryReminderShownThisSession()).toBe(true);

    await signOutAndGoWelcome({
      signOut: jest.fn().mockResolvedValue(undefined),
      replace: jest.fn(),
    });

    expect(recoveryReminderShownThisSession()).toBe(false);
  });
});

