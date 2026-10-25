type E2eVoiceModule = {
  loadE2eVoiceBytes?: () => Uint8Array;
};

export const E2E_VOICE_DURATION_SECONDS = 20;

export function assertE2eVoiceSampleGated(): void {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return;
  }
  let loaded: E2eVoiceModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('./e2eVoiceSample.bundle') as E2eVoiceModule;
  } catch {
    return;
  }
  let sample: unknown;
  try {
    sample = loaded.loadE2eVoiceBytes?.();
  } catch {
    return;
  }
  if (sample) {
    throw new Error('E2E voice samples are reachable in a non-e2e build.');
  }
}

export function loadE2eVoiceBytes(): Uint8Array {
  if (process.env.EXPO_PUBLIC_E2E !== '1') {
    throw new Error('E2E voice samples are not available in this build.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('./e2eVoiceSample.bundle') as E2eVoiceModule;
  const bytes = loaded.loadE2eVoiceBytes?.();
  if (!bytes) {
    throw new Error('E2E voice samples are not available in this build.');
  }
  return bytes;
}
