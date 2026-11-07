import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Calendar } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { Pressable as GesturePressable } from 'react-native-gesture-handler';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ChoiceChip,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  SheetModal,
  Small,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  formatBirthdayYmd,
  isOnOrBeforeTodayLocal,
  pickerDateToYmd,
  ymdToPickerDate,
} from '../letters/letterDates';
import {
  fetchProfileDateOfBirth,
  updateOwnDateOfBirth,
} from '../letters/letterApi';
import { useCurrentFamily } from './useCurrentFamily';

function todayLocalYmd(): string {
  return pickerDateToYmd(new Date());
}

function defaultPastYmd(): string {
  // Eleven years ago: age 18 is still in the future for e2e / first save.
  const now = new Date();
  return pickerDateToYmd(new Date(now.getFullYear() - 11, now.getMonth(), now.getDate(), 12));
}

export function ProfileScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { userId } = useCurrentFamily();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftYmd, setDraftYmd] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const dobQuery = useQuery({
    queryKey: ['ownDateOfBirth', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchProfileDateOfBirth(userId!),
  });

  const savedYmd = dobQuery.data ?? null;
  const displayYmd = draftYmd !== null ? draftYmd : savedYmd;
  const maxYmd = todayLocalYmd();

  const openPicker = () => {
    setFormError(null);
    setSaved(false);
    if (draftYmd !== null) {
      setDraftYmd(draftYmd === '' ? defaultPastYmd() : draftYmd);
    } else {
      setDraftYmd(savedYmd ?? defaultPastYmd());
    }
    setPickerOpen(true);
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      setPickerOpen(false);
      return;
    }
    if (!selected) {
      return;
    }
    const next = pickerDateToYmd(selected);
    setDraftYmd(isOnOrBeforeTodayLocal(next) ? next : maxYmd);
    if (Platform.OS === 'android') {
      setPickerOpen(false);
    }
  };

  const clearBirthday = () => {
    setDraftYmd('');
    setPickerOpen(false);
    setSaved(false);
    setFormError(null);
  };

  const onSave = async () => {
    if (!userId) {
      return;
    }
    const next =
      draftYmd !== null
        ? draftYmd.trim() === ''
          ? null
          : draftYmd
        : savedYmd;
    if (next && !isOnOrBeforeTodayLocal(next)) {
      setFormError(copy.profile.birthInvalid);
      return;
    }
    setFormError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateOwnDateOfBirth(userId, next);
      await queryClient.invalidateQueries({ queryKey: ['ownDateOfBirth', userId] });
      setDraftYmd(null);
      setSaved(true);
    } catch (error) {
      logFailedAction(error);
      setFormError(copy.profile.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (!userId || dobQuery.isLoading) {
    return (
      <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (dobQuery.isError) {
    return (
      <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const label =
    displayYmd && displayYmd.length > 0
      ? formatBirthdayYmd(displayYmd)
      : copy.profile.birthEmpty;

  return (
    <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
      <Title>{copy.profile.title}</Title>
      <Body>{copy.profile.body}</Body>
      <View style={styles.field}>
        <Small tone="muted">{copy.profile.birthLabel}</Small>
        <GesturePressable
          testID="profile-birthday"
          accessibilityRole="button"
          accessibilityLabel={`${copy.profile.birthLabel}: ${label}`}
          onPress={openPicker}
          style={[
            styles.dateTrigger,
            { backgroundColor: colors.surface, borderColor: colors.hairline },
          ]}
        >
          <Body style={styles.dateLabel}>{label}</Body>
          <Icon icon={Calendar} name="calendar" size={20} color={colors.textMuted} />
        </GesturePressable>
        <Caption tone="muted">{copy.profile.birthHint}</Caption>
      </View>
      {formError ? <ErrorState message={formError} /> : null}
      {saved ? <Banner message={copy.profile.saved} tone="info" /> : null}
      <Button
        label={copy.profile.save}
        onPress={() => void onSave()}
        busy={saving}
        testID="profile-save"
      />

      {pickerOpen && Platform.OS === 'android' && displayYmd ? (
        <DateTimePicker
          value={ymdToPickerDate(displayYmd || defaultPastYmd())}
          mode="date"
          display="default"
          maximumDate={ymdToPickerDate(maxYmd)}
          onChange={onPickerChange}
        />
      ) : null}

      {pickerOpen && Platform.OS === 'ios' ? (
        <SheetModal
          visible
          onClose={() => setPickerOpen(false)}
          testID="profile-birthday-sheet"
          accessibilityLabel={copy.profile.birthLabel}
        >
          <Title>{copy.profile.birthLabel}</Title>
          {displayYmd ? (
            <Body testID="profile-birthday-preview">{formatBirthdayYmd(displayYmd)}</Body>
          ) : (
            <Body testID="profile-birthday-preview">{copy.profile.birthEmpty}</Body>
          )}
          {displayYmd ? (
            <DateTimePicker
              value={ymdToPickerDate(displayYmd)}
              mode="date"
              display="spinner"
              maximumDate={ymdToPickerDate(maxYmd)}
              onChange={onPickerChange}
              style={styles.iosPicker}
            />
          ) : null}
          {process.env.EXPO_PUBLIC_E2E === '1' ? (
            <View style={styles.chipRow}>
              <ChoiceChip
                label="2015-06-15"
                selected={displayYmd === '2015-06-15'}
                onPress={() => setDraftYmd('2015-06-15')}
                testID="profile-birthday-e2e-young"
              />
              <ChoiceChip
                label="1990-01-01"
                selected={displayYmd === '1990-01-01'}
                onPress={() => setDraftYmd('1990-01-01')}
                testID="profile-birthday-e2e-older"
              />
            </View>
          ) : null}
          <ButtonStack>
            <Button
              label={copy.profile.birthDone}
              onPress={() => setPickerOpen(false)}
              testID="profile-birthday-done"
            />
            <Button
              label={copy.profile.birthClear}
              variant="secondary"
              onPress={clearBirthday}
              testID="profile-birthday-clear"
            />
          </ButtonStack>
        </SheetModal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
