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
import { formatMeetingWhen, nextMeetingAt } from './syncSchedule';
import { useSyncSpace } from './useSyncSpace';

const schema = z.object({
  weekday: z.number().int().min(0).max(6),
  localTime: z.string().refine(isValidLocalTime),
  timezone: z.string().trim().refine(isValidTimezone),
  circleId: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

function previewFor(values: FormValues): string | null {
  if (!isValidLocalTime(values.localTime) || !isValidTimezone(values.timezone.trim())) {
    return null;
  }
  try {
    const timezone = values.timezone.trim();
    const next = nextMeetingAt({
      weekday: values.weekday,
      localTime: normalizeLocalTime(values.localTime),
      timezone,
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
  };
  const preview = previewFor(values);

  const onSave = handleSubmit(
    async (input) => {
      if (!spaceId) {
        return;
      }
      setFormError(null);
      setSaving(true);
      try {
        const timezone = input.timezone.trim();
        const localTime = normalizeLocalTime(input.localTime);
        await upsertSyncSchedule({
          spaceId,
          weekday: input.weekday,
          localTime,
          timezone,
          circleId: input.circleId,
          nextScheduledFor: nextMeetingAt({ weekday: input.weekday, localTime, timezone }),
        });
        sync.refresh();
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
