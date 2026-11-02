import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ChoiceChip,
  ErrorState,
  Field,
  LoadingState,
  Screen,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { randomUuid } from '../../lib/crypto/random';
import { fetchMembers, fetchOwnDisplayName } from '../../lib/family';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { VoiceNoteField } from '../vault/VoiceNoteField';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { defaultTimezone } from '../sync/syncLabels';
import {
  addYearsToYmd,
  formatLetterDate,
  isAfterToday,
  isValidYmd,
  zonedMidnightIso,
} from './letterDates';
import {
  fetchFamilyTimezone,
  fetchLetter,
  letterRecipientReady,
  letterWriterReady,
  type LetterVisibility,
} from './letterApi';
import { letterReleaseReadyForSealing } from './letterReleaseConfig';
import { sealLetterOnDevice } from './letterSeal';

const schema = z.object({
  // Empty is OK until seal — we fill From with the member's name when it loads.
  fromLabel: z.string().trim().max(80),
  body: z.string().trim().min(1).max(20000),
  dateYmd: z.string().trim().min(1),
});

type FormValues = z.infer<typeof schema>;

export function NewLetterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ letterId?: string }>();
  const editId = typeof params.letterId === 'string' ? params.letterId : undefined;
  const { userId, spaceId } = useCurrentFamily();
  const [letterId] = useState(() => editId ?? randomUuid());
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<LetterVisibility | null>(null);
  const [sealing, setSealing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sealedFingerprint, setSealedFingerprint] = useState<string | null>(null);
  const [sealedDate, setSealedDate] = useState<string | null>(null);
  const [sealedName, setSealedName] = useState<string | null>(null);
  const [voicePlain, setVoicePlain] = useState<Uint8Array | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (voicePlain) {
        wipe(voicePlain);
      }
    };
  }, [voicePlain]);

  const writerQuery = useQuery({
    queryKey: ['letterWriterReady', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () => letterWriterReady(spaceId!, userId!),
  });

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId!),
  });

  const nameQuery = useQuery({
    queryKey: ['ownDisplayName', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchOwnDisplayName(userId!),
  });

  const tzQuery = useQuery({
    queryKey: ['familyTimezone', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFamilyTimezone(spaceId!),
  });

  const existingQuery = useQuery({
    queryKey: ['letter', editId],
    enabled: Boolean(editId),
    queryFn: () => fetchLetter(editId!),
  });

  const timeZone = tzQuery.data ?? defaultTimezone();
  const todayYmd = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, [timeZone]);

  const { control, handleSubmit, setValue, getValues } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromLabel: '',
      body: '',
      dateYmd: addYearsToYmd(todayYmd, 1),
    },
  });

  useEffect(() => {
    if (nameQuery.data && !getValues('fromLabel') && !existingQuery.data) {
      setValue('fromLabel', nameQuery.data);
    }
  }, [nameQuery.data, existingQuery.data, getValues, setValue]);

  const existing = existingQuery.data?.authorId === userId ? existingQuery.data : undefined;
  const effectiveVisibility: LetterVisibility =
    visibility ?? existing?.visibility ?? 'surprise';

  const candidates = useMemo(() => {
    return (membersQuery.data ?? []).filter((m) => m.userId !== userId);
  }, [membersQuery.data, userId]);

  const readyQuery = useQuery({
    queryKey: ['letterRecipientsReady', spaceId, candidates.map((c) => c.userId).join(',')],
    enabled: Boolean(spaceId && candidates.length > 0),
    queryFn: async () => {
      const flags: Record<string, boolean> = {};
      await Promise.all(
        candidates.map(async (m) => {
          flags[m.userId] = await letterRecipientReady(spaceId!, m.userId);
        }),
      );
      return flags;
    },
  });

  const readyMembers = candidates.filter((m) => readyQuery.data?.[m.userId]);
  // Default to the first ready recipient without an effect (lint: no setState in effect).
  const effectiveRecipientId =
    recipientId ?? existing?.recipientId ?? readyMembers[0]?.userId ?? null;

  const onSeal = handleSubmit(async (values) => {
    setFormError(null);
    if (!letterReleaseReadyForSealing()) {
      setFormError(copy.letters.releaseNotReady);
      return;
    }
    if (!spaceId || !userId || !effectiveRecipientId) {
      setFormError(copy.letters.sealFailed);
      return;
    }
    if (!isValidYmd(values.dateYmd) || !isAfterToday(values.dateYmd, timeZone)) {
      setFormError(
        !isValidYmd(values.dateYmd) ? copy.letters.dateInvalid : copy.letters.dateInPast,
      );
      return;
    }
    setSealing(true);
    try {
      const triggerAt = zonedMidnightIso(values.dateYmd, timeZone);
      const result = await sealLetterOnDevice({
        letterId,
        familySpaceId: spaceId,
        authorId: userId,
        recipientId: effectiveRecipientId,
        fromLabel: values.fromLabel.trim() || existing?.fromLabel || nameQuery.data || 'Family',
        visibility: effectiveVisibility,
        triggerAt,
        body: values.body,
        voicePlain,
        voiceDurationSeconds: voiceDuration,
        previousVersion: existing?.version,
        createDraft: !editId,
      });
      if (!result.ok) {
        const base =
          result.reason === 'too_large'
            ? copy.letters.sealTooLarge
            : result.reason === 'recipient_not_ready'
              ? copy.letters.recipientNeedsOpen
              : copy.letters.sealFailed;
        setFormError(
          process.env.EXPO_PUBLIC_E2E === '1' && result.detail
            ? `${base} (${result.detail})`
            : base,
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
      const name =
        readyMembers.find((m) => m.userId === effectiveRecipientId)?.displayName ??
        copy.letters.formerMember;
      setSealedName(name);
      setSealedDate(formatLetterDate(triggerAt, timeZone));
      setSealedFingerprint(result.fingerprint);
    } catch (error) {
      logFailedAction(error);
      setFormError(copy.letters.sealFailed);
    } finally {
      setSealing(false);
    }
  });

  if (!spaceId || !userId || writerQuery.isLoading || membersQuery.isLoading) {
    return (
      <Screen testID="screen-letter-new" >
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!letterReleaseReadyForSealing()) {
    return (
      <Screen testID="screen-letter-new">
        <Banner message={copy.letters.releaseNotReady} tone="warning" />
      </Screen>
    );
  }

  if (writerQuery.data === false) {
    return (
      <Screen testID="screen-letter-new" >
        <Banner message={copy.letters.notForYou} tone="warning" />
      </Screen>
    );
  }

  if (sealedFingerprint && sealedName && sealedDate) {
    return (
      <Screen testID="screen-letter-sealed" >
        <Title>{copy.letters.sealedTitle}</Title>
        <Body>
          {copy.letters.sealedBody.replace('{name}', sealedName).replace('{date}', sealedDate)}
        </Body>
        <View
          testID="letter-seal-code"
          accessibilityLabel={`${copy.letters.fingerprintLabel}: ${sealedFingerprint}`}
        >
          <Caption>
            {copy.letters.fingerprintLabel}: {sealedFingerprint}
          </Caption>
        </View>
        <View testID={`fingerprint-${sealedFingerprint}`} />
        <Button
          label={copy.letters.done}
          onPress={() => router.replace(routes.letters)}
          testID="letter-sealed-done"
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="screen-letter-new"
      
    >
      <Title>{editId ? copy.letters.editTitle : copy.letters.newTitle}</Title>
      <Caption>{copy.letters.toLabel}</Caption>
      {readyMembers.length === 0 ? (
        <Banner message={copy.letters.noRecipients} tone="warning" />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {readyMembers.map((m) => (
            <ChoiceChip
              key={m.userId}
              label={m.displayName}
              selected={effectiveRecipientId === m.userId}
              onPress={() => setRecipientId(m.userId)}
              testID={`recipient-${m.userId}`}
            />
          ))}
        </View>
      )}

      <Controller
        control={control}
        name="fromLabel"
        render={({ field: { value, onChange }, fieldState }) => (
          <Field
            label={copy.letters.fromLabel}
            value={value}
            onChangeText={onChange}
            error={fieldState.error ? copy.letters.fromHint : undefined}
            testID="letter-from"
            
          />
        )}
      />

      <Controller
        control={control}
        name="body"
        render={({ field: { value, onChange }, fieldState }) => (
          <Field
            label={copy.letters.bodyLabel}
            value={value}
            onChangeText={onChange}
            multiline
            placeholder={copy.letters.bodyPlaceholder}
            error={fieldState.error ? copy.letters.bodyLabel : undefined}
            testID="letter-body"
          />
        )}
      />

      <Caption>{copy.letters.voiceOptional}</Caption>
      <VoiceNoteField
        durationSeconds={voiceDuration}
        recordTestID="letter-record-voice"
        onRecorded={(draft) => {
          if (voicePlain) {
            wipe(voicePlain);
          }
          setVoicePlain(draft.plain);
          setVoiceDuration(draft.durationSeconds);
        }}
        onRemove={() => {
          if (voicePlain) {
            wipe(voicePlain);
          }
          setVoicePlain(null);
          setVoiceDuration(null);
        }}
      />

      <Caption>{copy.letters.howTheyFind}</Caption>
      <ChoiceChip
        label={copy.letters.surprise}
        selected={effectiveVisibility === 'surprise'}
        onPress={() => setVisibility('surprise')}
        testID="visibility-surprise"
      />
      <Caption>{copy.letters.surpriseHint}</Caption>
      <ChoiceChip
        label={copy.letters.announced}
        selected={effectiveVisibility === 'announced'}
        onPress={() => setVisibility('announced')}
        testID="visibility-announced"
      />
      <Caption>{copy.letters.announcedHint}</Caption>

      <Controller
        control={control}
        name="dateYmd"
        render={({ field: { value, onChange } }) => (
          <Field
            label={copy.letters.dateLabel}
            value={value}
            onChangeText={onChange}
            placeholder={copy.letters.datePlaceholder}
            testID="letter-date"
          />
        )}
      />
      <Caption>{copy.letters.dateHint.replace('{zone}', timeZone)}</Caption>
      <ButtonStack>
        <Button
          label={copy.letters.inOneYear}
          variant="ghost"
          onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 1))}
          testID="letter-date-1y"
        />
        <Button
          label={copy.letters.inFiveYears}
          variant="ghost"
          onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 5))}
          testID="letter-date-5y"
        />
        <Button
          label={copy.letters.inTenYears}
          variant="ghost"
          onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 10))}
          testID="letter-date-10y"
        />
      </ButtonStack>

      {formError ? <ErrorState message={formError} /> : null}

      <Button
        label={editId ? copy.letters.resealed : copy.letters.seal}
        onPress={() => void onSeal()}
        busy={sealing}
        disabled={!effectiveRecipientId || sealing}
        testID="seal-letter"
        
      />
    </Screen>
  );
}
