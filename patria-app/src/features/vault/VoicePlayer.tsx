import { View } from 'react-native';

import { Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import type { VaultAudioRef } from '../../lib/crypto/vaultEnvelope';
import { formatVoiceLength } from './vaultOpen';

export type VoicePlayerProps = {
  spaceId: string;
  entryId: string;
  audio: VaultAudioRef;
  /**
   * When false, skip the "Voice note · length" line (Home already shows length
   * under the title). Default true for Vault entry.
   */
  showLengthLine?: boolean;
  /**
   * Play button style. Omit on Home so CardTone supplies mustard on warm.
   * Vault entry keeps secondary.
   */
  playVariant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
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
        {props.showLengthLine === false ? null : (
          <Caption testID="voice-note">
            {copy.vault.voiceNote} · {formatVoiceLength(props.audio.durationSeconds)}
          </Caption>
        )}
        <ErrorState message={copy.vault.openFailed} />
      </View>
    );
  }
  return <Native {...props} />;
}
