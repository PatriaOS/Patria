import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { z } from 'zod';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import {
  Banner,
  Body,
  Button,
  Caption,
  ChoiceChip,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Screen,
  Small,
} from '../../ui';
import { space } from '../../theme/tokens';
import { upsertSyncSchedule } from './syncApi';
import {
  circleDisplayName,
  defaultTimezone,
  fillTemplate,
  isValidLocalTime,
  isValidTimezone,
  normalizeLocalTime,
  SYNC_CIRCLE_KINDS,
} from './syncLabels';
import {
  formatMeetingWhen,
  nextMeetingAt,
  type SyncFrequency,
  type SyncMonthlyMode,
} from './syncSchedule';
import { useSyncSpace } from './useSyncSpace';

const schema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    localTime: z.string().refine(isValidLocalTime),
    timezone: z.string().trim().refine(isValidTimezone),
    circleId: z.string().min(1),
    frequency: z.enum(['weekly', 'every_two_weeks', 'monthly']),
    monthlyMode: z.enum(['same_weekday', 'same_date']).nullable(),
    monthlyOrdinal: z.number().int().nullable(),
    monthDay: z.number().int().min(1).max(31).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency !== 'monthly') {
      return;
    }
    if (value.monthlyMode === 'same_weekday' && value.monthlyOrdinal == null) {
      ctx.addIssue({ code: 'custom', path: ['monthlyOrdinal'], message: 'ordinal' });
    }
    if (value.monthlyMode === 'same_date' && value.monthDay == null) {
      ctx.addIssue({ code: 'custom', path: ['monthDay'], message: 'day' });
    }
    if (value.monthlyMode == null) {
      ctx.addIssue({ code: 'custom', path: ['monthlyMode'], message: 'mode' });
    }
  });

type FormValues = z.infer<typeof schema>;

const FREQUENCIES: SyncFrequency[] = ['weekly', 'every_two_weeks', 'monthly'];
const MONTHLY_MODES: SyncMonthlyMode[] = ['same_weekday', 'same_date'];
const ORDINALS = [1, 2, 3, 4, -1] as const;

function previewFor(values: FormValues, anchorLocalDate: string | null): string | null {
  if (!isValidLocalTime(values.localTime) || !isValidTimezone(values.timezone.trim())) {
    return null;
  }
  try {
    const timezone = values.timezone.trim();
    const next = nextMeetingAt({
      weekday: values.weekday,
      localTime: normalizeLocalTime(values.localTime),
      timezone,
      frequency: values.frequency,
      monthlyMode: values.monthlyMode,
      monthlyOrdinal: values.monthlyOrdinal,
      monthDay: values.monthDay,
      anchorLocalDate:
        values.frequency === 'every_two_weeks' ? (anchorLocalDate ?? undefined) : undefined,
    });
    return fillTemplate(copy.sync.nextMeetingPreview, { when: formatMeetingWhen(next, timezone) });
  } catch {
    return null;
  }
}

export function SyncScheduleScreen() {
  const router = useRouter();
  const sync = useSyncSpace();
  const { spaceId, admin, schedule, circlesQuery } = sync;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [movedNotice, setMovedNotice] = useState(false);
  const timezoneRef = useRef<TextInputInstance>(null);

  const circles = (circlesQuery.data ?? []).filter((circle) =>
    (SYNC_CIRCLE_KINDS as readonly string[]).includes(circle.kind),
  );
  const householdId = circles.find((circle) => circle.kind === 'household')?.id ?? '';

  const { control, handleSubmit, reset, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      weekday: 0,
      localTime: '19:00',
      timezone: defaultTimezone(),
      circleId: '',
      frequency: 'weekly',
      monthlyMode: 'same_weekday',
      monthlyOrdinal: 1,
      monthDay: 1,
    },
  });

  const watched = useWatch({ control });
  const scheduleLoaded = sync.scheduleQuery.isSuccess;
  useEffect(() => {
    if (!scheduleLoaded || (!schedule && !householdId)) {
      return;
    }
    reset({
      weekday: schedule?.weekday ?? 0,
      localTime: schedule ? schedule.localTime.slice(0, 5) : '19:00',
      timezone: schedule?.timezone ?? defaultTimezone(),
      circleId: schedule?.circleId ?? householdId,
      frequency: schedule?.frequency ?? 'weekly',
      monthlyMode: schedule?.monthlyMode ?? 'same_weekday',
      monthlyOrdinal: schedule?.monthlyOrdinal ?? 1,
      monthDay: schedule?.monthDay ?? 1,
    });
  }, [scheduleLoaded, schedule, householdId, reset]);

  if (sync.loading) {
    return (
      <Screen withHeader testID="screen-sync-schedule" accessibilityLabel={copy.sync.scheduleTitle}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (sync.failed) {
    return (
      <Screen withHeader testID="screen-sync-schedule" accessibilityLabel={copy.sync.scheduleTitle}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  if (!admin) {
    return (
      <Screen withHeader testID="screen-sync-schedule" accessibilityLabel={copy.sync.scheduleTitle}>
        {schedule ? (
          <>
            <Small tone="muted">{copy.sync.frequencyLabel}</Small>
            <Body>{copy.sync.frequencies[schedule.frequency]}</Body>
            <Small tone="muted">{copy.sync.weekdayLabel}</Small>
            <Body>{copy.sync.weekdaysLong[schedule.weekday]}</Body>
            <Small tone="muted">{copy.sync.timeLabel}</Small>
            <Body>{schedule.localTime.slice(0, 5)}</Body>
            <Small tone="muted">{copy.sync.timezoneLabel}</Small>
            <Body>{schedule.timezone}</Body>
            <Small tone="muted">{copy.sync.circleLabel}</Small>
            <Body>
              {circleDisplayName(circlesQuery.data?.find((row) => row.id === schedule.circleId))}
            </Body>
            <Caption>{copy.sync.scheduleReadOnly}</Caption>
          </>
        ) : (
          <EmptyState title={copy.sync.title} message={copy.sync.askAdminSetup} />
        )}
      </Screen>
    );
  }

  const values: FormValues = {
    weekday: watched.weekday ?? 0,
    localTime: watched.localTime ?? '',
    timezone: watched.timezone ?? '',
    circleId: watched.circleId ?? '',
    frequency: watched.frequency ?? 'weekly',
    monthlyMode: watched.monthlyMode ?? 'same_weekday',
    monthlyOrdinal: watched.monthlyOrdinal ?? 1,
    monthDay: watched.monthDay ?? 1,
  };
  const preview = previewFor(values, schedule?.anchorLocalDate ?? null);
  const showMonthDayHint =
    values.frequency === 'monthly' &&
    values.monthlyMode === 'same_date' &&
    (values.monthDay ?? 0) >= 29;

  const onSave = handleSubmit(
    async (input) => {
      if (!spaceId) {
        return;
      }
      setFormError(null);
      setMovedNotice(false);
      setSaving(true);
      try {
        const timezone = input.timezone.trim();
        const localTime = normalizeLocalTime(input.localTime);
        const result = await upsertSyncSchedule({
          spaceId,
          weekday: input.weekday,
          localTime,
          timezone,
          circleId: input.circleId,
          frequency: input.frequency,
          monthlyMode: input.frequency === 'monthly' ? input.monthlyMode : null,
          monthlyOrdinal:
            input.frequency === 'monthly' && input.monthlyMode === 'same_weekday'
              ? input.monthlyOrdinal
              : null,
          monthDay:
            input.frequency === 'monthly' && input.monthlyMode === 'same_date'
              ? input.monthDay
              : null,
        });
        sync.refresh();
        if (result.movedPreserved) {
          setMovedNotice(true);
          return;
        }
        router.replace(routes.sync);
      } catch (caught) {
        logFailedAction(caught);
        setFormError(copy.sync.saveFailed);
      } finally {
        setSaving(false);
      }
    },
    () => setFormError(null),
  );

  return (
    <Screen
      withHeader
      keyboardAware
      testID="screen-sync-schedule"
      accessibilityLabel={copy.sync.scheduleTitle}
    >
      {formError ? <ErrorState message={formError} /> : null}
      {movedNotice ? <Banner message={copy.sync.movedMeetingPreserved} /> : null}
      <Small tone="muted">{copy.sync.frequencyLabel}</Small>
      <View style={styles.chips}>
        {FREQUENCIES.map((frequency) => (
          <ChoiceChip
            key={frequency}
            label={copy.sync.frequencies[frequency]}
            testID={`frequency-${frequency}`}
            selected={values.frequency === frequency}
            onPress={() => setValue('frequency', frequency, { shouldDirty: true })}
          />
        ))}
      </View>
      {values.frequency === 'monthly' ? (
        <>
          <Small tone="muted">{copy.sync.monthlyModeLabel}</Small>
          <View style={styles.chips}>
            {MONTHLY_MODES.map((mode) => (
              <ChoiceChip
                key={mode}
                label={copy.sync.monthlyModes[mode]}
                testID={`monthly-mode-${mode}`}
                selected={values.monthlyMode === mode}
                onPress={() => setValue('monthlyMode', mode, { shouldDirty: true })}
              />
            ))}
          </View>
          {values.monthlyMode === 'same_weekday' ? (
            <>
              <Small tone="muted">{copy.sync.monthlyOrdinalLabel}</Small>
              <View style={styles.chips}>
                {ORDINALS.map((ordinal) => (
                  <ChoiceChip
                    key={ordinal}
                    label={copy.sync.monthlyOrdinals[String(ordinal) as '1' | '2' | '3' | '4' | '-1']}
                    testID={`monthly-ordinal-${ordinal}`}
                    selected={values.monthlyOrdinal === ordinal}
                    onPress={() => setValue('monthlyOrdinal', ordinal, { shouldDirty: true })}
                  />
                ))}
              </View>
            </>
          ) : (
            <Controller
              control={control}
              name="monthDay"
              render={({ field }) => (
                <Field
                  label={copy.sync.monthDayLabel}
                  placeholder="15"
                  value={field.value != null ? String(field.value) : ''}
                  onChangeText={(text) => {
                    const parsed = Number.parseInt(text.replace(/\D/g, ''), 10);
                    field.onChange(Number.isFinite(parsed) ? Math.min(31, Math.max(1, parsed)) : null);
                  }}
                  keyboardType="number-pad"
                  testID="month-day"
                />
              )}
            />
          )}
          {showMonthDayHint ? <Caption>{copy.sync.monthDayHint}</Caption> : null}
        </>
      ) : null}
      <Small tone="muted">{copy.sync.weekdayLabel}</Small>
      <View style={styles.chips}>
        {copy.sync.weekdaysShort.map((label, index) => (
          <ChoiceChip
            key={label}
            label={label}
            accessibilityLabel={copy.sync.weekdaysLong[index]}
            testID={`weekday-${label.toLowerCase()}`}
            selected={values.weekday === index}
            onPress={() => setValue('weekday', index, { shouldDirty: true })}
          />
        ))}
      </View>
      <Controller
        control={control}
        name="localTime"
        render={({ field, fieldState }) => (
          <Field
            label={copy.sync.timeLabel}
            placeholder={copy.sync.timePlaceholder}
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error ? copy.sync.timeError : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => timezoneRef.current?.focus()}
          />
        )}
      />
      <Caption>{copy.sync.timeHint}</Caption>
      <Controller
        control={control}
        name="timezone"
        render={({ field, fieldState }) => (
          <Field
            ref={timezoneRef}
            label={copy.sync.timezoneLabel}
            placeholder={copy.sync.timezonePlaceholder}
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error ? copy.sync.timezoneError : undefined}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
      <Small tone="muted">{copy.sync.circleLabel}</Small>
      <View style={styles.chips}>
        {circles.map((circle) => (
          <ChoiceChip
            key={circle.id}
            label={circleDisplayName(circle)}
            selected={values.circleId === circle.id}
            onPress={() => setValue('circleId', circle.id, { shouldDirty: true })}
          />
        ))}
      </View>
      {preview ? <Body tone="muted">{preview}</Body> : null}
      <Button label={copy.sync.saveSchedule} onPress={() => void onSave()} busy={saving} />
      {movedNotice ? (
        <Button label={copy.sync.backToSync} variant="secondary" onPress={() => router.replace(routes.sync)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
});
