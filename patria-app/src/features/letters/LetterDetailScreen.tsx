import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ErrorState,
  LoadingState,
  Screen,
  SheetModal,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { fetchMembers } from '../../lib/family';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { useCurrentFamily } from '../family/useCurrentFamily';
import {
  formatLetterOpenDay,
  isAfterToday,
  tomorrowYmd,
  ymdInZone,
  zonedMidnightIso,
} from './letterDates';
import {
  fetchFamilyTimezone,
  fetchLetter,
  setLetterOpenDate,
  withdrawLetter,
} from './letterApi';
import { LetterVoicePlayback } from './LetterVoicePlayback';
import { openLetterAsAuthor, openLetterAsRecipient } from './letterOpen';

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

export function LetterDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ letterId?: string }>();
  const letterId = typeof params.letterId === 'string' ? params.letterId : '';
  const { userId, spaceId } = useCurrentFamily();
  const [busy, setBusy] = useState(false);
  const [openedBody, setOpenedBody] = useState<string | null>(null);
  const [voicePlain, setVoicePlain] = useState<Uint8Array | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [matches, setMatches] = useState<boolean | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [changeDateOpen, setChangeDateOpen] = useState(false);
  const [changeDateYmd, setChangeDateYmd] = useState<string | null>(null);
  const [changeDateError, setChangeDateError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (voicePlain) {
        wipe(voicePlain);
      }
    };
  }, [voicePlain]);

  const letterQuery = useQuery({
    queryKey: ['letter', letterId],
    enabled: Boolean(letterId),
    queryFn: () => fetchLetter(letterId),
  });
  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId!),
  });
  const tzQuery = useQuery({
    queryKey: ['familyTimezone', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFamilyTimezone(spaceId!),
  });

  const letter = letterQuery.data;
  const timeZone = tzQuery.data ?? 'America/New_York';
  const minYmd = tomorrowYmd(timeZone);
  const isAuthor = letter?.authorId === userId;
  const isRecipient = letter?.recipientId === userId;
  const recipientName =
    membersQuery.data?.find((m) => m.userId === letter?.recipientId)?.displayName ??
    copy.letters.formerMember;

  const runWithdraw = async () => {
    setConfirmWithdraw(false);
    setBusy(true);
    try {
      await withdrawLetter(letterId);
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
      router.replace(routes.letters);
    } catch (error) {
      logFailedAction(error);
      setOpenError(copy.letters.withdrawFailed);
    } finally {
      setBusy(false);
    }
  };

  const openChangeDate = () => {
    if (!letter) {
      return;
    }
    setChangeDateError(null);
    setChangeDateYmd(ymdInZone(letter.triggerAt, timeZone));
    setChangeDateOpen(true);
  };

  const onChangeDatePicker = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      // keep sheet open until Save
    }
    if (event.type === 'dismissed' || !selected) {
      return;
    }
    const next = pickerDateToYmd(selected, timeZone);
    setChangeDateYmd(isAfterToday(next, timeZone) ? next : minYmd);
  };

  const saveOpenDate = async () => {
    if (!changeDateYmd || !isAfterToday(changeDateYmd, timeZone)) {
      setChangeDateError(copy.letters.dateInPast);
      return;
    }
    setBusy(true);
    setChangeDateError(null);
    try {
      await setLetterOpenDate(letterId, zonedMidnightIso(changeDateYmd, timeZone));
      await queryClient.invalidateQueries({ queryKey: ['letter', letterId] });
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
      setChangeDateOpen(false);
    } catch (error) {
      logFailedAction(error);
      setChangeDateError(copy.letters.changeOpenDateFailed);
    } finally {
      setBusy(false);
    }
  };

  const onReread = async () => {
    if (!spaceId || !userId) {
      return;
    }
    setBusy(true);
    setOpenError(null);
    try {
      const result = await openLetterAsAuthor({ letterId, spaceId, userId });
      if (!result.ok) {
        setOpenError(
          result.reason === 'no_author_share'
            ? copy.letters.rereadUnavailable
            : copy.letters.openFailed,
        );
        return;
      }
      if (voicePlain) {
        wipe(voicePlain);
      }
      setOpenedBody(result.content.body);
      setVoicePlain(result.voicePlain ?? null);
      setVoiceDuration(result.content.audio?.durationSeconds ?? null);
      setFingerprint(result.fingerprint);
      setMatches(result.matches);
    } catch (error) {
      logFailedAction(error);
      setOpenError(copy.letters.openFailed);
    } finally {
      setBusy(false);
    }
  };

  const onOpenAsRecipient = async () => {
    if (!spaceId || !userId) {
      return;
    }
    setBusy(true);
    setOpenError(null);
    try {
      const result = await openLetterAsRecipient({ letterId, spaceId, userId });
      if (!result.ok) {
        setOpenError(
          result.reason === 'not_ready' ? copy.letters.notYet : copy.letters.openFailed,
        );
        return;
      }
      if (!result.matches) {
        setOpenError(
          copy.letters.sealMismatch.replace('{name}', result.letter.fromLabel),
        );
        return;
      }
      if (voicePlain) {
        wipe(voicePlain);
      }
      setOpenedBody(result.content.body);
      setVoicePlain(result.voicePlain ?? null);
      setVoiceDuration(result.content.audio?.durationSeconds ?? null);
      setFingerprint(result.fingerprint);
      setMatches(true);
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
    } catch (error) {
      logFailedAction(error);
      setOpenError(copy.letters.openFailed);
    } finally {
      setBusy(false);
    }
  };

  if (letterQuery.isLoading) {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!letter) {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const openDate = formatLetterOpenDay(ymdInZone(letter.triggerAt, timeZone), timeZone);

  if (isRecipient && letter.status === 'sealed' && letter.visibility === 'announced') {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <Title>
          {copy.letters.announcedStubTitle.replace('{name}', letter.fromLabel)}
        </Title>
        <Body>{copy.letters.announcedStubBody.replace('{date}', openDate)}</Body>
      </Screen>
    );
  }

  if (isRecipient && (letter.status === 'pending' || letter.status === 'released')) {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <Title>
          {openedBody
            ? copy.letters.openedTitle.replace('{name}', letter.fromLabel)
            : copy.letters.pendingTitle}
        </Title>
        {openedBody ? null : (
          <Caption>{copy.letters.pendingFrom.replace('{name}', letter.fromLabel)}</Caption>
        )}
        {openedBody ? (
          <>
            <Body testID="letter-opened-body">{openedBody}</Body>
            {voicePlain && voiceDuration != null ? (
              <LetterVoicePlayback plain={voicePlain} durationSeconds={voiceDuration} />
            ) : null}
            {fingerprint ? (
              <Caption testID={`fingerprint-${fingerprint}`}>
                {copy.letters.sealMatches
                  .replace('{code}', fingerprint)
                  .replace('{name}', letter.fromLabel)}
              </Caption>
            ) : null}
          </>
        ) : (
          <Button
            label={copy.letters.openLetter}
            onPress={() => void onOpenAsRecipient()}
            busy={busy}
            testID="open-letter"
          />
        )}
        {openError ? <ErrorState message={openError} /> : null}
        {matches === false ? (
          <Banner
            tone="danger"
            message={copy.letters.sealMismatch.replace('{name}', letter.fromLabel)}
          />
        ) : null}
      </Screen>
    );
  }

  if (!isAuthor) {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  return (
    <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
      <Title>{copy.letters.forLine.replace('{name}', recipientName)}</Title>
      <Caption>
        {copy.letters.opensOn.replace('{date}', openDate)} ·{' '}
        {letter.visibility === 'announced'
          ? copy.letters.announcedBadge
          : copy.letters.surpriseBadge}
      </Caption>
      {letter.recipientLeftAt ? (
        <Banner
          tone="warning"
          message={copy.letters.recipientLeft.replace('{name}', recipientName)}
        />
      ) : null}
      {letter.fingerprint ? (
        <Caption testID={`fingerprint-${letter.fingerprint}`}>
          {copy.letters.fingerprintLabel}: {letter.fingerprint}
        </Caption>
      ) : null}

      {openedBody ? (
        <>
          <Body testID="letter-reread-body">{openedBody}</Body>
          {voicePlain && voiceDuration != null ? (
            <LetterVoicePlayback plain={voicePlain} durationSeconds={voiceDuration} />
          ) : null}
          <Button
            label={copy.letters.hideLetter}
            variant="ghost"
            onPress={() => {
              if (voicePlain) {
                wipe(voicePlain);
              }
              setVoicePlain(null);
              setVoiceDuration(null);
              setOpenedBody(null);
            }}
            testID="hide-letter"
          />
        </>
      ) : null}

      {openError ? <ErrorState message={openError} /> : null}

      <ButtonStack>
        {!openedBody ? (
          <Button
            label={copy.letters.reread}
            onPress={() => void onReread()}
            busy={busy}
            testID="reread-letter"
          />
        ) : null}
        {letter.status === 'sealed' && !letter.recipientLeftAt ? (
          <>
            <Button
              label={copy.letters.edit}
              variant="secondary"
              onPress={() => router.push(routes.letterNew(letter.id))}
              testID="edit-letter"
            />
            <Button
              label={copy.letters.changeOpenDate}
              variant="secondary"
              onPress={openChangeDate}
              testID="change-open-date"
            />
          </>
        ) : null}
        {letter.status === 'draft' || letter.status === 'sealed' ? (
          <Button
            label={copy.letters.withdraw}
            variant="danger"
            onPress={() => setConfirmWithdraw(true)}
            busy={busy}
            testID="withdraw-letter"
          />
        ) : null}
      </ButtonStack>

      <SheetModal
        visible={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        testID="withdraw-letter-confirm"
        accessibilityLabel={copy.letters.withdraw}
      >
        <Title>{copy.letters.withdraw}</Title>
        <Body>{copy.letters.withdrawConfirm}</Body>
        <ButtonStack>
          <Button
            label={copy.letters.withdraw}
            variant="danger"
            onPress={() => void runWithdraw()}
            busy={busy}
            testID="withdraw-letter-confirm-yes"
          />
          <Button
            label={copy.common.cancel}
            variant="secondary"
            onPress={() => setConfirmWithdraw(false)}
            testID="withdraw-letter-confirm-cancel"
          />
        </ButtonStack>
      </SheetModal>

      <SheetModal
        visible={changeDateOpen}
        onClose={() => setChangeDateOpen(false)}
        testID="change-open-date-sheet"
        accessibilityLabel={copy.letters.changeOpenDate}
      >
        <Title>{copy.letters.changeOpenDate}</Title>
        {changeDateYmd ? (
          <Body testID="change-open-date-preview">
            {formatLetterOpenDay(changeDateYmd, timeZone)}
          </Body>
        ) : null}
        {changeDateYmd && Platform.OS === 'android' ? (
          <DateTimePicker
            value={ymdToPickerDate(changeDateYmd, timeZone)}
            mode="date"
            display="default"
            minimumDate={ymdToPickerDate(minYmd, timeZone)}
            onChange={onChangeDatePicker}
          />
        ) : null}
        {changeDateYmd && Platform.OS === 'ios' ? (
          <DateTimePicker
            value={ymdToPickerDate(changeDateYmd, timeZone)}
            mode="date"
            display="spinner"
            minimumDate={ymdToPickerDate(minYmd, timeZone)}
            onChange={onChangeDatePicker}
            style={styles.iosPicker}
          />
        ) : null}
        {changeDateError ? <ErrorState message={changeDateError} /> : null}
        <ButtonStack>
          <Button
            label={copy.letters.changeOpenDateSave}
            onPress={() => void saveOpenDate()}
            busy={busy}
            testID="change-open-date-save"
          />
          <Button
            label={copy.common.cancel}
            variant="secondary"
            onPress={() => setChangeDateOpen(false)}
            testID="change-open-date-cancel"
          />
        </ButtonStack>
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iosPicker: {
    alignSelf: 'stretch',
  },
});
