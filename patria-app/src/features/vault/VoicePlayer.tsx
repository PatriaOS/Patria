import { View } from 'react-native';

import { Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import type { VaultAudioRef } from '../../lib/crypto/vaultEnvelope';
import { formatVoiceLength } from './vaultOpen';

export type VoicePlayerProps = {
  spaceId: string;
  entryId: string;
  audio: VaultAudioRef;
};

export function VoicePlayer(props: VoicePlayerProps) {
  let Native: typeof import('./VoicePlayerNative').VoicePlayerNative | null = null;
  try {
    // Lazy so opening the vault does not need ExpoAudio in older binaries.
    // The E2E sample replaces only the microphone; playback always uses this path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Native = (require('./VoicePlayerNative') as typeof import('./VoicePlayerNative')).VoicePlayerNative;
  } catch {
    Native = null;
  }
  if (!Native) {
    return (
      <View>
        <Caption testID="voice-note">
          {copy.vault.voiceNote} · {formatVoiceLength(props.audio.durationSeconds)}
        </Caption>
        <ErrorState message={copy.vault.openFailed} />
      </View>
    );
  }
  return <Native {...props} />;
}
