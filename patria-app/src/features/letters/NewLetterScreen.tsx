import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Calendar } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ChoiceChip,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  LoadingState,
  Pressable,
  Screen,
  SelectField,
  SheetModal,
  Small,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { randomUuid } from '../../lib/crypto/random';
import { fetchMembers, fetchOwnDisplayName } from '../../lib/family';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';
import { VoiceNoteField } from '../vault/VoiceNoteField';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { defaultTimezone } from '../sync/syncLabels';
import {
  addYearsToYmd,
  formatLetterOpenDay,
  friendlyTimeZoneName,
  isAfterToday,
  isValidYmd,
  tomorrowYmd,
  ymdInZone,
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
  body: z.string().trim().max(20000),
  dateYmd: z.string().trim().min(1),
});

type FormValues = z.infer<typeof schema>;

function ymdToPickerDate(ymd: string, timeZone: string): Date {
  try {
    return new Date(zonedMidnightIso(ymd, timeZone));
  } catch {
    return new Date();
  }
}

function pickerDateToYmd(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function NewLetterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ letterId?: string }>();
  const editId = typeof params.letterId === 'string' ? params.letterId : undefined;
  const { userId, spaceId } = useCurrentFamily();
  const [letterId] = useState(() => editId ?? randomUuid());
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<LetterVisibility>('surprise');
  const [sealing, setSealing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sealedFingerprint, setSealedFingerprint] = useState<string | null>(null);
  const [sealedDate, setSealedDate] = useState<string | null>(null);
  const [sealedName, setSealedName] = useState<string | null>(null);
  const [sealCodeChanged, setSealCodeChanged] = useState(false);
  const [voicePlain, setVoicePlain] = useState<Uint8Array | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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
  const minYmd = tomorrowYmd(timeZone);
  const zoneLabel = friendlyTimeZoneName(timeZone);

  const { control, handleSubmit, setValue, getValues, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromLabel: '',
      body: '',
      dateYmd: addYearsToYmd(todayYmd, 1),
    },
  });
  const bodyValue = watch('body');
  const dateYmd = watch('dateYmd');

  useEffect(() => {
    if (nameQuery.data && !getValues('fromLabel') && !existingQuery.data) {
      setValue('fromLabel', nameQuery.data);
    }
  }, [nameQuery.data, existingQuery.data, getValues, setValue]);

  const existing = existingQuery.data?.authorId === userId ? existingQuery.data : undefined;

  useEffect(() => {
    if (!existing) {
      return;
    }
    setVisibility(existing.visibility);
    if (existing.triggerAt) {
      try {
        setValue('dateYmd', ymdInZone(existing.triggerAt, timeZone));
      } catch {
        // Keep the form default.
      }
    }
    if (existing.fromLabel) {
      setValue('fromLabel', existing.fromLabel);
    }
  }, [existing, setValue, timeZone]);

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
  const notReadyMembers = candidates.filter((m) => readyQuery.data && !readyQuery.data[m.userId]);
  // Default to the first ready recipient without an effect (lint: no setState in effect).
  const effectiveRecipientId =
    recipientId ?? existing?.recipientId ?? readyMembers[0]?.userId ?? null;
  const hasContent = Boolean(bodyValue?.trim()) || Boolean(voicePlain && voiceDuration);
  const sealBlockedReason = !effectiveRecipientId
    ? copy.letters.sealNeedRecipient
    : !hasContent
      ? copy.letters.sealNeedContent
      : null;
  const canSeal = !sealing && !sealBlockedReason;

  const onSeal = handleSubmit(async (values) => {
    setFormError(null);
    if (!letterReleaseReadyForSealing()) {
      setFormError(copy.letters.releaseNotReady);
      return;
    }
    if (!spaceId || !userId || !effectiveRecipientId) {
      setFormError(copy.letters.sealNeedRecipient);
      return;
    }
    if (!values.body.trim() && !(voicePlain && voiceDuration)) {
      setFormError(copy.letters.sealNeedContent);
      return;
    }
    if (!isValidYmd(values.dateYmd) || !isAfterToday(values.dateYmd, timeZone)) {
      setFormError(copy.letters.dateInPast);
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
        visibility,
        triggerAt,
        body: values.body.trim(),
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
      const previousCode = existing?.fingerprint?.trim() ?? '';
      setSealCodeChanged(
        Boolean(editId && previousCode && previousCode !== result.fingerprint),
      );
      setSealedName(name);
      setSealedDate(formatLetterOpenDay(values.dateYmd, timeZone));
      setSealedFingerprint(result.fingerprint);
    } catch (error) {
      logFailedAction(error);
      setFormError(copy.letters.sealFailed);
    } finally {
      setSealing(false);
    }
  });

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setDatePickerOpen(false);
    }
    if (event.type === 'dismissed' || !selected) {
      return;
    }
    const next = pickerDateToYmd(selected, timeZone);
    if (isAfterToday(next, timeZone)) {
      setValue('dateYmd', next);
    } else {
      setValue('dateYmd', minYmd);
    }
  };

  if (!spaceId || !userId || writerQuery.isLoading || membersQuery.isLoading) {
    return (
      <Screen withHeader testID="screen-letter-new">
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!letterReleaseReadyForSealing()) {
    return (
      <Screen withHeader testID="screen-letter-new">
        <EmptyState
          title={copy.letters.comingSoonTitle}
          message={copy.letters.comingSoonBody}
        />
      </Screen>
    );
  }

  if (writerQuery.data === false) {
    return (
      <Screen withHeader testID="screen-letter-new">
        <Banner message={copy.letters.notForYou} tone="warning" />
      </Screen>
    );
  }

  if (sealedFingerprint && sealedName && sealedDate) {
    return (
      <Screen withHeader testID="screen-letter-sealed">
        <Title>
          {sealCodeChanged ? copy.letters.sealCodeChangedTitle : copy.letters.sealedTitle}
        </Title>
        <Body>
          {sealCodeChanged
            ? copy.letters.sealCodeChangedBody.replace('{date}', sealedDate)
            : copy.letters.sealedBody
                .replace('{name}', sealedName)
                .replace('{date}', sealedDate)}
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
    <Screen withHeader testID="screen-letter-new">
      <Caption>{copy.letters.toLabel}</Caption>
      {readyMembers.length === 0 ? (
        <Banner message={copy.letters.noRecipients} tone="info" />
      ) : (
        <View style={styles.chipRow}>
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
      {readyMembers.length > 0 && notReadyMembers.length > 0 ? (
        <Caption tone="muted">
          {copy.letters.notReadyYet.replace(
            '{names}',
            notReadyMembers.map((m) => m.displayName).join(', '),
          )}
        </Caption>
      ) : null}

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
        render={({ field: { value, onChange } }) => (
          <Field
            label={copy.letters.bodyLabel}
            value={value}
            onChangeText={onChange}
            multiline
            placeholder={copy.letters.bodyPlaceholder}
            testID="letter-body"
          />
        )}
      />

      <View style={styles.voiceBlock}>
        <Caption>{copy.letters.voiceOptional}</Caption>
        <ButtonStack>
          <VoiceNoteField
            durationSeconds={voiceDuration}
            hideCaption
            recordLabel={copy.letters.recordVoice}
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
        </ButtonStack>
      </View>

      <SelectField
        label={copy.letters.howTheyFind}
        value={visibility}
        testID="letter-visibility"
        sheetTestID="letter-visibility-sheet"
        onChange={setVisibility}
        options={[
          {
            value: 'surprise',
            label: copy.letters.surprise,
            description: copy.letters.surpriseHint,
            testID: 'visibility-surprise',
          },
          {
            value: 'announced',
            label: copy.letters.announced,
            description: copy.letters.announcedHint,
            testID: 'visibility-announced',
          },
        ]}
      />

      <View style={styles.field}>
        <Small tone="muted">{copy.letters.dateLabel}</Small>
        <Pressable
          testID="letter-date"
          accessibilityRole="button"
          accessibilityLabel={`${copy.letters.dateLabel}: ${formatLetterOpenDay(dateYmd, timeZone)}`}
          onPress={() => setDatePickerOpen(true)}
          style={[
            styles.dateTrigger,
            { backgroundColor: colors.surface, borderColor: colors.hairline },
          ]}
        >
          <Body style={styles.dateLabel}>{formatLetterOpenDay(dateYmd, timeZone)}</Body>
          <Icon icon={Calendar} name="calendar" size={20} color={colors.textMuted} />
        </Pressable>
        <View
          accessible
          accessibilityLabel={copy.letters.dateHint.replace('{zone}', zoneLabel)}
          accessibilityHint={timeZone}
        >
          <Caption tone="muted">{copy.letters.dateHint.replace('{zone}', zoneLabel)}</Caption>
        </View>
        <View style={styles.chipRow}>
          <ChoiceChip
            label={copy.letters.inOneYear}
            selected={dateYmd === addYearsToYmd(todayYmd, 1)}
            onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 1))}
            testID="letter-date-1y"
          />
          <ChoiceChip
            label={copy.letters.inFiveYears}
            selected={dateYmd === addYearsToYmd(todayYmd, 5)}
            onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 5))}
            testID="letter-date-5y"
          />
          <ChoiceChip
            label={copy.letters.inTenYears}
            selected={dateYmd === addYearsToYmd(todayYmd, 10)}
            onPress={() => setValue('dateYmd', addYearsToYmd(todayYmd, 10))}
            testID="letter-date-10y"
          />
        </View>
      </View>

      {datePickerOpen && Platform.OS === 'android' ? (
        <DateTimePicker
          value={ymdToPickerDate(dateYmd, timeZone)}
          mode="date"
          display="default"
          minimumDate={ymdToPickerDate(minYmd, timeZone)}
          onChange={onPickerChange}
        />
      ) : null}

      {datePickerOpen && Platform.OS === 'ios' ? (
        <SheetModal
          visible
          onClose={() => setDatePickerOpen(false)}
          testID="letter-date-sheet"
          accessibilityLabel={copy.letters.dateLabel}
        >
          <DateTimePicker
            value={ymdToPickerDate(dateYmd, timeZone)}
            mode="date"
            display="spinner"
            minimumDate={ymdToPickerDate(minYmd, timeZone)}
            onChange={onPickerChange}
            style={styles.iosPicker}
          />
          <Button
            label={copy.letters.done}
            onPress={() => setDatePickerOpen(false)}
            testID="letter-date-done"
          />
        </SheetModal>
      ) : null}

      {formError ? <ErrorState message={formError} /> : null}

      <ButtonStack>
        <Button
          label={editId ? copy.letters.resealed : copy.letters.seal}
          onPress={() => void onSeal()}
          busy={sealing}
          disabled={!canSeal}
          testID="seal-letter"
        />
        {sealBlockedReason ? (
          <Caption tone="muted" testID="seal-letter-hint">
            {sealBlockedReason}
          </Caption>
        ) : null}
      </ButtonStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  voiceBlock: {
    gap: space.xs,
  },
  field: {
    gap: space.xs,
  },
  dateTrigger: {
    borderRadius: radius.tile,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dateLabel: {
    flex: 1,
  },
  iosPicker: {
    alignSelf: 'stretch',
  },
});
