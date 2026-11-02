import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../ui';
import { copy } from '../../lib/copy';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatLetterDate } from './letterDates';
import { fetchFamilyTimezone, fetchLetters, letterWriterReady, type LetterRow } from './letterApi';

function statusLabel(row: LetterRow): string {
  if (row.recipientLeftAt) {
    return copy.letters.statusRecipientLeft;
  }
  if (row.status === 'pending') {
    return copy.letters.statusPending;
  }
  if (row.status === 'released') {
    return copy.letters.statusReleased;
  }
  return copy.letters.statusSealed;
}

export function LettersScreen() {
  const router = useRouter();
  const { userId, spaceId, current } = useCurrentFamily();

  const writerQuery = useQuery({
    queryKey: ['letterWriterReady', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () => letterWriterReady(spaceId!, userId!),
  });

  const lettersQuery = useQuery({
    queryKey: ['letters', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchLetters(spaceId!),
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

  const authored = useMemo(
    () => (lettersQuery.data ?? []).filter((row) => row.authorId === userId),
    [lettersQuery.data, userId],
  );
  const forMe = useMemo(
    () => (lettersQuery.data ?? []).filter((row) => row.recipientId === userId),
    [lettersQuery.data, userId],
  );

  const timeZone = tzQuery.data ?? 'America/New_York';
  const memberName = (id: string) =>
    membersQuery.data?.find((m) => m.userId === id)?.displayName ?? copy.letters.formerMember;

  if (!spaceId || !userId || !current) {
    return (
      <Screen testID="screen-letters" >
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (lettersQuery.isError || writerQuery.isError) {
    return (
      <Screen testID="screen-letters" >
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  if (lettersQuery.isLoading || writerQuery.isLoading) {
    return (
      <Screen testID="screen-letters" >
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  return (
    <Screen testID="screen-letters" >
      <Banner message={copy.letters.lockNote} />
      {writerQuery.data ? (
        <Button
          label={copy.letters.write}
          onPress={() => router.push(routes.letterNew())}
          testID="write-letter"
          
        />
      ) : (
        <Banner message={copy.letters.notForYou} tone="warning" />
      )}

      {authored.length === 0 && forMe.length === 0 ? (
        <EmptyState title={copy.letters.emptyTitle} message={copy.letters.emptyBody} />
      ) : null}

      {authored.map((row) => (
        <ListRow
          key={row.id}
          title={copy.letters.forLine.replace('{name}', memberName(row.recipientId))}
          body={copy.letters.opensOn.replace('{date}', formatLetterDate(row.triggerAt, timeZone))}
          onPress={() => router.push(routes.letterDetail(row.id))}
          testID={`letter-${row.id}`}
          trailing={<StatusPill label={statusLabel(row)} />}
        />
      ))}

      {forMe.map((row) => (
        <ListRow
          key={`recv-${row.id}`}
          title={copy.letters.announcedStubTitle.replace('{name}', row.fromLabel)}
          body={copy.letters.opensOn.replace('{date}', formatLetterDate(row.triggerAt, timeZone))}
          onPress={() => router.push(routes.letterDetail(row.id))}
          testID={`letter-recv-${row.id}`}
          trailing={<StatusPill label={statusLabel(row)} />}
        />
      ))}
    </Screen>
  );
}
