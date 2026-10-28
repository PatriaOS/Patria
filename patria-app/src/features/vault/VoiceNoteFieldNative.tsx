import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, ButtonStack, Caption, ErrorState } from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { VAULT_AUDIO_MAX_SECONDS } from '../../lib/crypto/vaultAudio';
import {
  formatVoiceTimer,
  readVoiceFileBytes,
  VAULT_RECORDING_OPTIONS,
  writeVoicePreviewFile,
} from './vaultVoice';
import type { VoiceNoteFieldProps } from './VoiceNoteField';

export function VoiceNoteFieldNative({
  durationSeconds,
  onRecorded,
  onRemove,
}: VoiceNoteFieldProps) {
  const recorder = useAudioRecorder(VAULT_RECORDING_OPTIONS as RecordingOptions);
  const recorderState = useAudioRecorderState(recorder);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewPlain, setPreviewPlain] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const player = useAudioPlayer(previewUri);
  const elapsed = (recorderState.durationMillis ?? 0) / 1000;
  const hasNote = durationSeconds != null;
  const stopRef = useRef<(hitLimit: boolean) => Promise<void>>(async () => undefined);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previewUri) {
      player.replace(previewUri);
    }
  }, [previewUri, player]);

  const stopRecording = useCallback(
    async (hitLimit: boolean) => {
      if (limitTimer.current) {
        clearTimeout(limitTimer.current);
        limitTimer.current = null;
      }
      if (!recorderState.isRecording && !hitLimit) {
        return;
      }
      setBusy(true);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) {
          setError(copy.vault.recordFailed);
          return;
        }
        const plain = await readVoiceFileBytes(uri);
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          // The encrypted draft is what we keep.
        }
        const duration = hitLimit ? 300 : Math.max(1, Math.round(elapsed));
        setPreviewPlain(plain);
        const playUri = await writeVoicePreviewFile(plain);
        setPreviewUri(playUri);
        onRecorded({ durationSeconds: duration, plain: new Uint8Array(plain) });
        if (hitLimit) {
          Alert.alert(copy.vault.record, copy.vault.voiceStopped);
        }
      } catch {
        setError(copy.vault.recordFailed);
      } finally {
        setBusy(false);
      }
    },
    [elapsed, onRecorded, recorder, recorderState.isRecording],
  );

  useEffect(() => {
    stopRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      if (previewPlain) {
        wipe(previewPlain);
      }
    };
  }, [previewPlain]);

  const startRecording = async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError(copy.vault.micDenied);
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    limitTimer.current = setTimeout(() => {
      void stopRef.current(true);
    }, VAULT_AUDIO_MAX_SECONDS * 1000);
  };

  return (
    <View>
      <Caption>{copy.vault.record}</Caption>
      {hasNote ? (
        <Caption>{formatVoiceTimer(durationSeconds)}</Caption>
      ) : recorderState.isRecording ? (
        <Caption>{formatVoiceTimer(elapsed)}</Caption>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {!hasNote && !recorderState.isRecording ? (
        <Button
          label={copy.vault.record}
          variant="secondary"
          onPress={() => void startRecording()}
          busy={busy}
        />
      ) : null}
      {recorderState.isRecording ? (
        <Button
          label={copy.vault.stop}
          variant="secondary"
          onPress={() => void stopRecording(false)}
          busy={busy}
        />
      ) : null}
      {hasNote ? (
        <ButtonStack>
          <Button
            label={copy.vault.play}
            variant="secondary"
            onPress={() => {
              if (previewUri) {
                player.play();
              }
            }}
          />
          <Button
            label={copy.vault.reRecord}
            variant="ghost"
            onPress={() => {
              onRemove();
              setPreviewUri(null);
              if (previewPlain) {
                wipe(previewPlain);
                setPreviewPlain(null);
              }
            }}
          />
          <Button label={copy.vault.removeVoice} variant="ghost" onPress={onRemove} />
        </ButtonStack>
      ) : null}
    </View>
  );
}
