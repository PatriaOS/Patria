function bytesFromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// Tiny silent AAC/M4A used only when EXPO_PUBLIC_E2E=1.
const SAMPLE_B64 =
  'AAAAGGZ0eXBtcDQyAAAAAGlzb21tcDQyAAAACG1vb3YAAAAkbWRHDQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export function loadE2eVoiceBytes(): Uint8Array {
  if (process.env.EXPO_PUBLIC_E2E !== '1') {
    throw new Error('E2E voice samples are not available in this build.');
  }
  return bytesFromBase64(SAMPLE_B64);
}
