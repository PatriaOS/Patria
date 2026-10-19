import * as SecureStore from 'expo-secure-store';

export type AppearanceChoice = 'system' | 'light' | 'dark';

export const APPEARANCE_KEY = 'patria.appearance';

const ALLOWED: readonly AppearanceChoice[] = ['system', 'light', 'dark'];

export function parseAppearance(value: string | null): AppearanceChoice {
  if (value && (ALLOWED as readonly string[]).includes(value)) {
    return value as AppearanceChoice;
  }
  return 'system';
}

export async function readAppearance(): Promise<AppearanceChoice> {
  try {
    const stored = await SecureStore.getItemAsync(APPEARANCE_KEY, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return parseAppearance(stored);
  } catch {
    return 'system';
  }
}

export async function writeAppearance(choice: AppearanceChoice): Promise<void> {
  await SecureStore.setItemAsync(APPEARANCE_KEY, choice, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
