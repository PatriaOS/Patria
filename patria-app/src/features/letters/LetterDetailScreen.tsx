import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  ErrorState,
  LoadingState,
  Screen,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { fetchMembers } from '../../lib/family';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatLetterDate } from './letterDates';
import {
  fetchFamilyTimezone,
  fetchLetter,
  withdrawLetter,
} from './letterApi';
import { LetterVoicePlayback } from './LetterVoicePlayback';
import { openLetterAsAuthor, openLetterAsRecipient } from './letterOpen';

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
  const isAuthor = letter?.authorId === userId;
  const isRecipient = letter?.recipientId === userId;
  const recipientName =
    membersQuery.data?.find((m) => m.userId === letter?.recipientId)?.displayName ??
    copy.letters.formerMember;

  const onWithdraw = () => {
    Alert.alert(copy.letters.withdraw, copy.letters.withdrawConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.letters.withdraw,
        style: 'destructive',
        onPress: () => {
          void (async () => {
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
          })();
        },
      },
    ]);
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
      <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!letter) {
    return (
      <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const openDate = formatLetterDate(letter.triggerAt, timeZone);

  if (isRecipient && letter.status === 'sealed' && letter.visibility === 'announced') {
    return (
      <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <Title>
          {copy.letters.announcedStubTitle.replace('{name}', letter.fromLabel)}
        </Title>
        <Body>{copy.letters.announcedStubBody.replace('{date}', openDate)}</Body>
      </Screen>
    );
  }

  if (isRecipient && (letter.status === 'pending' || letter.status === 'released')) {
    return (
      <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <Title>{copy.letters.pendingTitle}</Title>
        <Caption>{copy.letters.pendingFrom.replace('{name}', letter.fromLabel)}</Caption>
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
      <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  return (
    <Screen testID="screen-letter-detail" accessibilityLabel={copy.letters.detailTitle}>
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
          <Button
            label={copy.letters.edit}
            variant="secondary"
            onPress={() => router.push(routes.letterNew(letter.id))}
            testID="edit-letter"
          />
        ) : null}
        {letter.status === 'draft' || letter.status === 'sealed' ? (
          <Button
            label={copy.letters.withdraw}
            variant="danger"
            onPress={onWithdraw}
            busy={busy}
            testID="withdraw-letter"
          />
        ) : null}
      </ButtonStack>
    </Screen>
  );
}
