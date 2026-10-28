import { useAudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import { formatVoiceLength } from './vaultOpen';
import { decryptVaultAudioToCache, deleteVaultAudioCacheFile } from './vaultPlayback';
import type { VoicePlayerProps } from './VoicePlayer';

export function VoicePlayerNative({
  spaceId,
  entryId,
  audio,
  showLengthLine,
  playVariant,
}: VoicePlayerProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const player = useAudioPlayer(uri);

  useEffect(() => {
    return () => {
      if (uri) {
        void deleteVaultAudioCacheFile(uri);
      }
    };
  }, [uri]);

  const onPlay = async () => {
    setError(null);
    try {
      let next = uri;
      if (!next) {
        setBusy(true);
        next = await decryptVaultAudioToCache({ spaceId, entryId, audio });
        setUri(next);
        player.replace(next);
      }
      player.play();
    } catch {
      setError(copy.vault.openFailed);
    } finally {
      setBusy(false);
    }
  };

  const showLength = showLengthLine !== false;
  // Omit variant on Home so CardTone supplies mustard; Vault keeps secondary.
  const resolvedPlay = playVariant ?? (showLengthLine === false ? undefined : 'secondary');

  return (
    <View>
      {showLength ? (
        <Caption testID="voice-note">
          {copy.vault.voiceNote} · {formatVoiceLength(audio.durationSeconds)}
        </Caption>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <Button
        label={copy.vault.play}
        variant={resolvedPlay}
        testID={showLengthLine === false ? 'home-voice-play' : undefined}
        onPress={() => void onPlay()}
        busy={busy}
      />
    </View>
  );
}
