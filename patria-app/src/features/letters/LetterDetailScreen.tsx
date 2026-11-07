import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ErrorState,
  Field,
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
  pickerDateToYmd,
  ymdToPickerDate,
  isAfterToday,
  tomorrowYmd,
  ymdInZone,
  zonedMidnightIso,
} from './letterDates';
import {
  fetchFamilyTimezone,
  fetchLetter,
  fetchLetterKeeperHelp,
  fetchLetterKeepersForAuthor,
  fetchLettersForKeepers,
  setLetterAge,
  setLetterOpenDate,
  withdrawLetter,
} from './letterApi';
import { helpRecipientOpenLetter } from './letterKeeperRelease';
import { letterOpensOnLine } from './letterOpenLabel';
import { LetterVoicePlayback } from './LetterVoicePlayback';
import {
  openLetterAsAuthor,
  openLetterAsRecipient,
  openLetterAsRecipientWithKeepers,
} from './letterOpen';

function parseAgeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 120) {
    return null;
  }
  return n;
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
  const [changeAgeOpen, setChangeAgeOpen] = useState(false);
  const [changeAgeRaw, setChangeAgeRaw] = useState('18');
  const [changeAgeError, setChangeAgeError] = useState<string | null>(null);
  const [askKeepers, setAskKeepers] = useState(false);
  const [keeperHelpBusy, setKeeperHelpBusy] = useState(false);
  const [keeperHelpDone, setKeeperHelpDone] = useState(false);
  const [keeperHelpError, setKeeperHelpError] = useState<string | null>(null);

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
  const authorKeepersQuery = useQuery({
    queryKey: ['letterKeepersAuthor', letterId],
    enabled: Boolean(letterId && userId && letterQuery.data?.authorId === userId),
    queryFn: () => fetchLetterKeepersForAuthor(letterId),
  });
  const keeperHelpQuery = useQuery({
    queryKey: ['letterKeeperHelp', letterId],
    enabled: Boolean(
      letterId &&
        userId &&
        letterQuery.data?.recipientId === userId &&
        (letterQuery.data?.status === 'pending' || letterQuery.data?.status === 'released'),
    ),
    queryFn: () => fetchLetterKeeperHelp(letterId),
    refetchInterval: askKeepers ? 4000 : false,
  });
  const keepingQuery = useQuery({
    queryKey: ['lettersForKeepers', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () => fetchLettersForKeepers(),
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
    if (!letter?.triggerAt) {
      return;
    }
    setChangeDateError(null);
    setChangeDateYmd(ymdInZone(letter.triggerAt, timeZone));
    setChangeDateOpen(true);
  };

  const openChangeAge = () => {
    if (!letter || letter.triggerAge == null) {
      return;
    }
    setChangeAgeError(null);
    setChangeAgeRaw(String(letter.triggerAge));
    setChangeAgeOpen(true);
  };

  const onChangeDatePicker = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      // keep sheet open until Save
    }
    if (event.type === 'dismissed' || !selected) {
      return;
    }
    const next = pickerDateToYmd(selected);
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

  const saveOpenAge = async () => {
    const age = parseAgeInput(changeAgeRaw);
    if (age == null) {
      setChangeAgeError(copy.letters.ageInvalid);
      return;
    }
    setBusy(true);
    setChangeAgeError(null);
    try {
      await setLetterAge(letterId, age);
      await queryClient.invalidateQueries({ queryKey: ['letter', letterId] });
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
      setChangeAgeOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      const already = /letter_age_already:([^\n]+)/.exec(message);
      if (already) {
        setChangeAgeError(
          copy.letters.ageAlready.replace(
            '{name}',
            already[1]?.trim() || recipientName,
          ),
        );
      } else {
        logFailedAction(error);
        setChangeAgeError(copy.letters.changeOpenAgeFailed);
      }
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

  const applyOpened = async (result: {
    content: { body: string; audio?: { durationSeconds: number } };
    fingerprint: string;
    voicePlain?: Uint8Array;
    letter: { fromLabel: string };
    matches: boolean;
  }) => {
    if (!result.matches) {
      setOpenError(copy.letters.sealMismatch.replace('{name}', result.letter.fromLabel));
      setMatches(false);
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
    setAskKeepers(false);
    await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
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
        if (result.reason === 'need_keepers') {
          setAskKeepers(true);
          setOpenError(null);
          return;
        }
        setOpenError(
          result.reason === 'not_ready' ? copy.letters.notYet : copy.letters.openFailed,
        );
        return;
      }
      await applyOpened(result);
    } catch (error) {
      logFailedAction(error);
      setOpenError(copy.letters.openFailed);
    } finally {
      setBusy(false);
    }
  };

  const onOpenWithKeepers = async () => {
    if (!spaceId || !userId) {
      return;
    }
    setBusy(true);
    setOpenError(null);
    try {
      const result = await openLetterAsRecipientWithKeepers({ letterId, spaceId, userId });
      if (!result.ok) {
        setOpenError(
          result.reason === 'need_keepers'
            ? copy.letters.keepersWaiting
            : result.reason === 'not_ready'
              ? copy.letters.notYet
              : copy.letters.openFailed,
        );
        return;
      }
      await applyOpened(result);
    } catch (error) {
      logFailedAction(error);
      setOpenError(copy.letters.openFailed);
    } finally {
      setBusy(false);
    }
  };

  const onKeeperHelp = async () => {
    const keeping =
      (keepingQuery.data ?? []).find((row) => row.letterId === letterId) ?? null;
    if (!spaceId || !userId || !keeping) {
      return;
    }
    setKeeperHelpBusy(true);
    setKeeperHelpError(null);
    try {
      const result = await helpRecipientOpenLetter({
        letterId,
        version: keeping.version,
        spaceId,
        keeperUserId: userId,
        recipientId: keeping.recipientId,
      });
      if (!result.ok) {
        setKeeperHelpError(copy.letters.keepersHelpFailed);
        return;
      }
      setKeeperHelpDone(true);
      await queryClient.invalidateQueries({ queryKey: ['lettersForKeepers', spaceId, userId] });
      await queryClient.invalidateQueries({ queryKey: ['letters', spaceId] });
    } catch (error) {
      logFailedAction(error);
      setKeeperHelpError(copy.letters.keepersHelpFailed);
    } finally {
      setKeeperHelpBusy(false);
    }
  };

  if (letterQuery.isLoading) {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  const keepingRowEarly = (keepingQuery.data ?? []).find((row) => row.letterId === letterId);
  if (!letter && keepingRowEarly) {
    return (
      <Screen withHeader testID="screen-letter-keeper" accessibilityLabel={copy.letters.keepersYouAreTitle}>
        <Title>{copy.letters.keepersYouAreTitle}</Title>
        <Body testID="keeper-assignment-body">
          {copy.letters.keepersYouAreBody
            .replace('{author}', keepingRowEarly.authorName)
            .replace('{recipient}', keepingRowEarly.recipientName)}
        </Body>
        {keeperHelpDone ? (
          <Caption testID="keeper-helped">{copy.letters.keepersHelped}</Caption>
        ) : keepingRowEarly.due ? (
          <Button
            label={copy.letters.keepersHelp}
            onPress={() => void onKeeperHelp()}
            busy={keeperHelpBusy}
            testID="keeper-help"
          />
        ) : null}
        {keeperHelpError ? <ErrorState message={keeperHelpError} /> : null}
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

  const openLine = letterOpensOnLine(letter, recipientName, timeZone);
  const announcedDate =
    letter.triggerAt != null
      ? formatLetterOpenDay(ymdInZone(letter.triggerAt, timeZone), timeZone)
      : openLine;

  if (isRecipient && letter.status === 'sealed' && letter.visibility === 'announced') {
    return (
      <Screen withHeader testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <Title>
          {copy.letters.announcedStubTitle.replace('{name}', letter.fromLabel)}
        </Title>
        <Body>{copy.letters.announcedStubBody.replace('{date}', announcedDate)}</Body>
      </Screen>
    );
  }

  if (isRecipient && (letter.status === 'pending' || letter.status === 'released')) {
    const helpedCount = (keeperHelpQuery.data ?? []).filter((row) => row.hasHelped).length;
    const hasKeepers = (keeperHelpQuery.data ?? []).length === 3;
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
          <ButtonStack>
            <Button
              label={copy.letters.openLetter}
              onPress={() => void onOpenAsRecipient()}
              busy={busy}
              testID="open-letter"
            />
            {askKeepers ? (
              <>
                <Banner message={copy.letters.keepersAskHint} tone="info" />
                <Button
                  label={copy.letters.keepersAsk}
                  variant="secondary"
                  onPress={() => setAskKeepers(true)}
                  testID="ask-keepers"
                />
                {hasKeepers ? (
                  <>
                    <Caption testID="keepers-progress">
                      {copy.letters.keepersProgress.replace(
                        '{n}',
                        String(Math.min(helpedCount, 2)),
                      )}
                    </Caption>
                    {(keeperHelpQuery.data ?? []).map((row) => (
                      <Caption key={row.keeperId} testID={`keeper-help-${row.slot}`}>
                        {row.keeperName}
                        {row.hasHelped ? ' · helped' : ''}
                      </Caption>
                    ))}
                    <Button
                      label={copy.letters.keepersOpenWith}
                      onPress={() => void onOpenWithKeepers()}
                      busy={busy}
                      disabled={helpedCount < 2}
                      testID="open-with-keepers"
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </ButtonStack>
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

  const keepingRow = (keepingQuery.data ?? []).find((row) => row.letterId === letterId);
  if (keepingRow && !isAuthor && !isRecipient) {
    return (
      <Screen withHeader testID="screen-letter-keeper" accessibilityLabel={copy.letters.keepersYouAreTitle}>
        <Title>{copy.letters.keepersYouAreTitle}</Title>
        <Body testID="keeper-assignment-body">
          {copy.letters.keepersYouAreBody
            .replace('{author}', keepingRow.authorName)
            .replace('{recipient}', keepingRow.recipientName)}
        </Body>
        {keeperHelpDone ? (
          <Caption testID="keeper-helped">{copy.letters.keepersHelped}</Caption>
        ) : keepingRow.due ? (
          <Button
            label={copy.letters.keepersHelp}
            onPress={() => void onKeeperHelp()}
            busy={keeperHelpBusy}
            testID="keeper-help"
          />
        ) : null}
        {keeperHelpError ? <ErrorState message={keeperHelpError} /> : null}
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
      <Caption testID="letter-open-day">
        {openLine} ·{' '}
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

      {(authorKeepersQuery.data ?? []).length > 0 ? (
        <View testID="letter-keepers-author">
          <Caption>{copy.letters.keepersSectionTitle}</Caption>
          <Caption>
            {copy.letters.keepersListLine.replace(
              '{names}',
              (authorKeepersQuery.data ?? []).map((k) => k.keeperName).join(', '),
            )}
          </Caption>
          {(authorKeepersQuery.data ?? []).some((k) => !k.stillMember) ? (
            <Banner tone="warning" message={copy.letters.keepersReplaceNeeded} />
          ) : null}
        </View>
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
            {letter.triggerKind === 'date' ? (
              <Button
                label={copy.letters.changeOpenDate}
                variant="secondary"
                onPress={openChangeDate}
                testID="change-open-date"
              />
            ) : (
              <Button
                label={copy.letters.changeOpenAge}
                variant="secondary"
                onPress={openChangeAge}
                testID="change-open-age"
              />
            )}
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
            value={ymdToPickerDate(changeDateYmd)}
            mode="date"
            display="default"
            minimumDate={ymdToPickerDate(minYmd)}
            onChange={onChangeDatePicker}
          />
        ) : null}
        {changeDateYmd && Platform.OS === 'ios' ? (
          <DateTimePicker
            value={ymdToPickerDate(changeDateYmd)}
            mode="date"
            display="spinner"
            minimumDate={ymdToPickerDate(minYmd)}
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

      <SheetModal
        visible={changeAgeOpen}
        onClose={() => setChangeAgeOpen(false)}
        testID="change-open-age-sheet"
        accessibilityLabel={copy.letters.changeOpenAge}
      >
        <Title>{copy.letters.changeOpenAge}</Title>
        <Field
          label={copy.letters.ageLabel}
          value={changeAgeRaw}
          onChangeText={setChangeAgeRaw}
          placeholder={copy.letters.agePlaceholder}
          keyboardType="number-pad"
          testID="change-open-age-input"
        />
        {changeAgeError ? <ErrorState message={changeAgeError} /> : null}
        <ButtonStack>
          <Button
            label={copy.letters.changeOpenAgeSave}
            onPress={() => void saveOpenAge()}
            busy={busy}
            testID="change-open-age-save"
          />
          <Button
            label={copy.common.cancel}
            variant="secondary"
            onPress={() => setChangeAgeOpen(false)}
            testID="change-open-age-cancel"
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
