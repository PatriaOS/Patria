import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  hydrateRecoveryReminderShown,
  markRecoveryReminderShown,
  recoveryReminderShownThisSession,
  resetRecoveryReminderMemoryForTests,
  shouldOfferRecoveryReminder,
} from '../features/family/recoveryReminderSession';
import { signOutAndGoWelcome } from './authSession';
import { routes } from './navigation';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('signOutAndGoWelcome', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetRecoveryReminderMemoryForTests();
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

  it('clears the recovery reminder marker so the next sign-in can offer it', async () => {
    await hydrateRecoveryReminderShown('u1');
    await markRecoveryReminderShown('u1');
    expect(recoveryReminderShownThisSession()).toBe(true);

    await signOutAndGoWelcome({
      userId: 'u1',
      signOut: jest.fn().mockResolvedValue(undefined),
      replace: jest.fn(),
    });

    await hydrateRecoveryReminderShown('u1');
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(true);
  });
});
