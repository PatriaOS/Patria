import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { E2E_VOICE_DURATION_SECONDS, loadE2eVoiceBytes } from './e2eVoiceSample';
import { formatVoiceTimer, writeVoicePreviewFile } from './vaultVoice';

export type VoiceDraft = {
  durationSeconds: number;
  plain: Uint8Array;
};

export type VoiceNoteFieldProps = {
  durationSeconds: number | null;
  onRecorded: (draft: VoiceDraft) => void;
  onRemove: () => void;
};

// E2E replaces only the microphone. onRecorded still encrypts through prepareVaultAudio.
function VoiceNoteFieldE2e({ durationSeconds, onRecorded, onRemove }: VoiceNoteFieldProps) {
  const [previewPlain, setPreviewPlain] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasNote = durationSeconds != null;

  useEffect(() => {
    return () => {
      if (previewPlain) {
        wipe(previewPlain);
      }
    };
  }, [previewPlain]);

  const startRecording = async () => {
    setError(null);
    setBusy(true);
    try {
      const plain = loadE2eVoiceBytes();
      setPreviewPlain(plain);
      await writeVoicePreviewFile(plain);
      onRecorded({ durationSeconds: E2E_VOICE_DURATION_SECONDS, plain: new Uint8Array(plain) });
    } catch {
      setError(copy.vault.recordFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Caption>{copy.vault.record}</Caption>
      {hasNote ? <Caption>{formatVoiceTimer(durationSeconds)}</Caption> : null}
      {error ? <ErrorState message={error} /> : null}
      {!hasNote ? (
        <Button
          label={copy.vault.record}
          variant="secondary"
          onPress={() => void startRecording()}
          busy={busy}
        />
      ) : (
        <>
          <Button label={copy.vault.play} variant="secondary" onPress={() => undefined} />
          <Button
            label={copy.vault.reRecord}
            variant="ghost"
            onPress={() => {
              onRemove();
              if (previewPlain) {
                wipe(previewPlain);
                setPreviewPlain(null);
              }
            }}
          />
          <Button label={copy.vault.removeVoice} variant="ghost" onPress={onRemove} />
        </>
      )}
    </View>
  );
}

export function VoiceNoteField(props: VoiceNoteFieldProps) {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return <VoiceNoteFieldE2e {...props} />;
  }
  let Native: typeof import('./VoiceNoteFieldNative').VoiceNoteFieldNative | null = null;
  try {
    // Lazy so Expo Router can load the vault screens without ExpoAudio in older binaries.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Native = (require('./VoiceNoteFieldNative') as typeof import('./VoiceNoteFieldNative'))
      .VoiceNoteFieldNative;
  } catch {
    Native = null;
  }
  if (!Native) {
    return (
      <View>
        <Caption>{copy.vault.record}</Caption>
        <ErrorState message={copy.vault.recordFailed} />
      </View>
    );
  }
  return <Native {...props} />;
}
