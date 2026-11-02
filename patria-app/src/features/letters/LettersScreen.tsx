import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';

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
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { isVaultWriterRole } from '../../lib/roles';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { canWriteVault } from '../vault/VaultScreen';
import { formatLetterDate } from './letterDates';
import { fetchFamilyTimezone, fetchLetters, type LetterRow } from './letterApi';
import { letterReleaseReadyForSealing } from './letterReleaseConfig';
import { ensureLetterboxKey } from './letterboxEnsure';

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
  const role = current?.role;

  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, role],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () =>
      ensureKeysForOpenFamily({
        spaceId: spaceId as string,
        userId: userId as string,
        role,
      }),
  });

  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, role),
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

  // Letterbox must exist before someone can receive; create on Letters as well as Home
  // so the first visit after recovery still works without bouncing through Home.
  useEffect(() => {
    if (keyStatusQuery.data !== 'ready' || !spaceId || !userId) {
      return;
    }
    void ensureLetterboxKey({ spaceId, userId }).catch(() => {
      // No personal key / recovery yet — seal gate and banners cover that.
    });
  }, [keyStatusQuery.data, spaceId, userId]);

  const releaseReady = letterReleaseReadyForSealing();
  const canWrite =
    releaseReady &&
    canWriteVault({
      role,
      keyReady: keyStatusQuery.data === 'ready',
      acceptedContacts: recoveryQuery.data?.accepted ?? 0,
      hasRecoveryPublic: Boolean(recoveryQuery.data?.hasRecoveryPublic),
    });
  const needsRecovery =
    releaseReady &&
    isVaultWriterRole(role) &&
    keyStatusQuery.data === 'ready' &&
    ((recoveryQuery.data?.accepted ?? 0) < 2 || !recoveryQuery.data?.hasRecoveryPublic);

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

  if (!spaceId || !userId || !current || keyStatusQuery.isLoading || recoveryQuery.isLoading) {
    return (
      <Screen testID="screen-letters">
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (lettersQuery.isError) {
    return (
      <Screen testID="screen-letters">
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  if (lettersQuery.isLoading) {
    return (
      <Screen testID="screen-letters">
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  return (
    <Screen testID="screen-letters">
      <Banner message={copy.letters.lockNote} />
      {!releaseReady ? (
        <EmptyState
          title={copy.letters.comingSoonTitle}
          message={copy.letters.comingSoonBody}
        />
      ) : null}
      {releaseReady && needsRecovery ? (
        <Banner
          message={copy.letters.recoveryFirst}
          action={
            <Button
              label={copy.letters.recoveryFirstAction}
              variant="secondary"
              onPress={() => router.push(routes.recoverySetup)}
              testID="letters-setup-recovery"
            />
          }
        />
      ) : null}
      {releaseReady && keyStatusQuery.data && keyStatusQuery.data !== 'ready' ? (
        <Banner message={copy.letters.approveOtherPhone} tone="warning" />
      ) : null}
      {canWrite ? (
        <Button
          label={copy.letters.write}
          onPress={() => router.push(routes.letterNew())}
          testID="write-letter"
        />
      ) : releaseReady && !needsRecovery && keyStatusQuery.data === 'ready' ? (
        <Banner message={copy.letters.notForYou} tone="warning" />
      ) : null}

      {releaseReady && authored.length === 0 && forMe.length === 0 ? (
        <EmptyState title={copy.letters.emptyTitle} message={copy.letters.emptyBody} />
      ) : null}

      {authored.map((row) => (
        <ListRow
          key={row.id}
          title={copy.letters.forLine.replace('{name}', memberName(row.recipientId))}
          body={copy.letters.opensOn.replace(
            '{date}',
            formatLetterDate(row.triggerAt, timeZone),
          )}
          onPress={() => router.push(routes.letterDetail(row.id))}
          testID={`letter-${row.id}`}
          trailing={
            <StatusPill
              testID={
                row.visibility === 'announced'
                  ? `letter-announced-${row.id}`
                  : `letter-status-${row.id}`
              }
              label={
                row.visibility === 'announced'
                  ? copy.letters.announcedBadge
                  : statusLabel(row)
              }
            />
          }
        />
      ))}

      {forMe.map((row) => (
        <ListRow
          key={`recv-${row.id}`}
          title={copy.letters.announcedStubTitle.replace('{name}', row.fromLabel)}
          body={copy.letters.opensOn.replace(
            '{date}',
            formatLetterDate(row.triggerAt, timeZone),
          )}
          onPress={() => router.push(routes.letterDetail(row.id))}
          testID={`letter-recv-${row.id}`}
          trailing={
            <StatusPill
              testID={`letter-recv-status-${row.id}`}
              label={statusLabel(row)}
            />
          }
        />
      ))}
    </Screen>
  );
}
