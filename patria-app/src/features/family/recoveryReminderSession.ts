/**
 * In-memory only: whether the post-sign-in recovery reminder was shown this
 * session. Never persisted. Cleared on sign out.
 */
let shownThisSession = false;

export function recoveryReminderShownThisSession(): boolean {
  return shownThisSession;
}

export function markRecoveryReminderShownThisSession(): void {
  shownThisSession = true;
}

export function clearRecoveryReminderSession(): void {
  shownThisSession = false;
}

export function shouldOfferRecoveryReminder(input: {
  keyHolder: boolean;
  recoveryAccepted: number;
  hasPaper: boolean;
  onboarding: boolean;
}): boolean {
  if (input.onboarding || shownThisSession || !input.keyHolder) {
    return false;
  }
  if (input.recoveryAccepted < 2) {
    return true;
  }
  return input.recoveryAccepted >= 2 && !input.hasPaper;
}
