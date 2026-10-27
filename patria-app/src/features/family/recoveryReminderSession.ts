import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Once per sign-in recovery reminder.
 * Memory tracks the current JS lifetime; AsyncStorage keeps a non-sensitive
 * "shown" marker per user so a cold start with the same session does not
 * show the sheet again. Cleared on sign out. Never store tokens, keys, or names.
 */
const storageKey = (userId: string) => `patria.recoveryReminder.shown.${userId}`;

let memoryUserId: string | null = null;
let memoryShown = false;
let hydratedUserId: string | null = null;

export function recoveryReminderShownThisSession(): boolean {
  return memoryShown;
}

export function recoveryReminderHydratedFor(userId: string): boolean {
  return hydratedUserId === userId;
}

/** Load the persisted marker before offering the sheet after a cold start. */
export async function hydrateRecoveryReminderShown(userId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  const shown = raw === '1';
  memoryUserId = userId;
  memoryShown = shown;
  hydratedUserId = userId;
  return shown;
}

/** Call when the reminder is actually shown after a real sign-in. */
export async function markRecoveryReminderShown(userId: string): Promise<void> {
  memoryUserId = userId;
  memoryShown = true;
  hydratedUserId = userId;
  await AsyncStorage.setItem(storageKey(userId), '1');
}

/** @deprecated Prefer markRecoveryReminderShown(userId) so cold starts stay quiet. */
export function markRecoveryReminderShownThisSession(): void {
  memoryShown = true;
}

export async function clearRecoveryReminderSession(userId?: string): Promise<void> {
  const id = userId ?? memoryUserId;
  memoryShown = false;
  hydratedUserId = null;
  memoryUserId = null;
  if (id) {
    await AsyncStorage.removeItem(storageKey(id));
  }
}

/** Test helper: drop in-memory state without touching AsyncStorage (cold start). */
export function resetRecoveryReminderMemoryForTests(): void {
  memoryShown = false;
  hydratedUserId = null;
  memoryUserId = null;
}

export function shouldOfferRecoveryReminder(input: {
  userId: string;
  keyHolder: boolean;
  recoveryAccepted: number;
  hasPaper: boolean;
  onboarding: boolean;
}): boolean {
  if (!recoveryReminderHydratedFor(input.userId)) {
    return false;
  }
  if (input.onboarding || memoryShown || !input.keyHolder) {
    return false;
  }
  if (input.recoveryAccepted < 2) {
    return true;
  }
  return input.recoveryAccepted >= 2 && !input.hasPaper;
}
