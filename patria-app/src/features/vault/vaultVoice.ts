import * as FileSystem from 'expo-file-system/legacy';

export const VAULT_RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: 'aac ',
    audioQuality: 0x40,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/mp4',
    bitsPerSecond: 64000,
  },
};

export function formatVoiceTimer(elapsedSeconds: number): string {
  const whole = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function voiceBytesFromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function voiceBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return globalThis.btoa(binary);
}

export async function readVoiceFileBytes(uri: string): Promise<Uint8Array> {
  const encoded = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return voiceBytesFromBase64(encoded);
}

export async function writeVoicePreviewFile(plain: Uint8Array): Promise<string> {
  const directory = FileSystem.cacheDirectory;
  if (!directory) {
    throw new Error('audio cache unavailable');
  }
  const path = `${directory}patria-vault-audio-preview.m4a`;
  await FileSystem.writeAsStringAsync(path, voiceBytesToBase64(plain), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}
