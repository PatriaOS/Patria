import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearRecoveryReminderSession,
  hydrateRecoveryReminderShown,
  markRecoveryReminderShown,
  recoveryReminderShownThisSession,
  resetRecoveryReminderMemoryForTests,
  shouldOfferRecoveryReminder,
} from './recoveryReminderSession';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('recoveryReminderSession', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetRecoveryReminderMemoryForTests();
  });

  it('offers once per sign-in after hydrate, and survives a cold start', async () => {
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

    await markRecoveryReminderShown('u1');
    expect(recoveryReminderShownThisSession()).toBe(true);
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);

    resetRecoveryReminderMemoryForTests();
    await hydrateRecoveryReminderShown('u1');
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);
  });

  it('does not offer until hydrated for that user', () => {
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);
  });

  it('clears the marker on sign out so the next sign-in can offer again', async () => {
    await hydrateRecoveryReminderShown('u1');
    await markRecoveryReminderShown('u1');
    await clearRecoveryReminderSession('u1');
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

  it('skips onboarding and non key holders', async () => {
    await hydrateRecoveryReminderShown('u1');
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferRecoveryReminder({
        userId: 'u1',
        keyHolder: false,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);
  });
});
