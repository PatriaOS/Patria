import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import { formatVoiceLength } from '../vault/vaultOpen';
import { writeVoicePreviewFile } from '../vault/vaultVoice';

type Props = {
  plain: Uint8Array;
  durationSeconds: number;
};

function LetterVoicePlaybackFallback({ durationSeconds }: { durationSeconds: number }) {
  return (
    <View>
      <Caption testID="letter-voice-note">
        {copy.letters.voiceNote} · {formatVoiceLength(durationSeconds)}
      </Caption>
      <ErrorState message={copy.vault.openFailed} />
    </View>
  );
}

function hasExpoAudio(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-audio');
    return true;
  } catch {
    return false;
  }
}

function LetterVoicePlaybackInner({ plain, durationSeconds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useAudioPlayer(uri);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await writeVoicePreviewFile(plain);
        if (!cancelled) {
          setUri(next);
        }
      } catch {
        if (!cancelled) {
          setError(copy.vault.openFailed);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plain]);

  useEffect(() => {
    if (uri) {
      player.replace(uri);
    }
  }, [uri, player]);

  return (
    <View>
      <Caption testID="letter-voice-note">
        {copy.letters.voiceNote} · {formatVoiceLength(durationSeconds)}
      </Caption>
      {error ? <ErrorState message={error} /> : null}
      <Button
        label={copy.vault.play}
        variant="secondary"
        onPress={() => {
          if (!uri) {
            return;
          }
          player.play();
        }}
        testID="letter-voice-play"
        disabled={!uri}
      />
    </View>
  );
}

export function LetterVoicePlayback(props: Props) {
  if (!hasExpoAudio()) {
    return <LetterVoicePlaybackFallback durationSeconds={props.durationSeconds} />;
  }
  return <LetterVoicePlaybackInner {...props} />;
}
