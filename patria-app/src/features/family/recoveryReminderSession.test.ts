import {
  clearRecoveryReminderSession,
  markRecoveryReminderShownThisSession,
  recoveryReminderShownThisSession,
  shouldOfferRecoveryReminder,
} from './recoveryReminderSession';

describe('recoveryReminderSession', () => {
  beforeEach(() => {
    clearRecoveryReminderSession();
  });

  it('offers once per session for recovery not set up', () => {
    expect(
      shouldOfferRecoveryReminder({
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(true);
    markRecoveryReminderShownThisSession();
    expect(recoveryReminderShownThisSession()).toBe(true);
    expect(
      shouldOfferRecoveryReminder({
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);
  });

  it('skips onboarding and non key holders', () => {
    expect(
      shouldOfferRecoveryReminder({
        keyHolder: true,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferRecoveryReminder({
        keyHolder: false,
        recoveryAccepted: 0,
        hasPaper: false,
        onboarding: false,
      }),
    ).toBe(false);
  });
});
