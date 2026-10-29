import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { Button, Card, EmptyState, LoadingState, Muted, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { fetchFirstDeviceNotices } from '../../lib/crypto/deviceAccess';
import { supabaseRecoverFlowGateway } from '../../lib/crypto/recoverFlow';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { fetchSyncMeetingAnswers, fetchSyncTasks } from '../sync/syncApi';
import { syncAnswersKey } from '../sync/syncQueryKeys';
import { defaultTimezone } from '../sync/syncLabels';
import { useSyncSpace } from '../sync/useSyncSpace';
import { countDeviceOrJoinAttention } from './deviceAttention';
import { buildNeedsYouItems } from './needsYou';
import { useCurrentFamily } from './useCurrentFamily';

export function NeedsYouScreen() {
  const router = useRouter();
  const { userId, spaceId, current, admin, keyHolder } = useCurrentFamily();
  const sync = useSyncSpace();
  const { refresh: refreshSync } = sync;
  const activeMeetingId = sync.active?.id;

  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, current?.role),
  });
  const noticesQuery = useQuery({
    queryKey: ['deviceApprovalNotices', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFirstDeviceNotices(spaceId as string),
  });
  const recoveryRequestsQuery = useQuery({
    queryKey: ['recoveryRequests', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => supabaseRecoverFlowGateway.listRequests(spaceId as string),
  });
  const removedNoticesQuery = useQuery({
    queryKey: ['deviceRemovedNotices', spaceId],
    enabled: Boolean(spaceId && admin),
    queryFn: () => supabaseRecoverFlowGateway.listRemovedNotices(spaceId as string),
  });
  const tasksQuery = useQuery({
    queryKey: ['syncTasks', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchSyncTasks(spaceId as string),
  });
  const syncAnswersQuery = useQuery({
    queryKey: syncAnswersKey(activeMeetingId),
    enabled: Boolean(activeMeetingId && sync.active?.status === 'upcoming'),
    queryFn: () => fetchSyncMeetingAnswers(activeMeetingId as string),
  });
  const refetchAnswers = syncAnswersQuery.refetch;
  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, current?.role],
    enabled: Boolean(spaceId && userId && current),
    queryFn: async () => {
      const { ensureKeysForOpenFamily } = await import('../../lib/crypto/familyCeremony');
      return ensureKeysForOpenFamily({
        spaceId: spaceId as string,
        userId: userId as string,
        role: current?.role,
      });
    },
  });

  useFocusEffect(
    useCallback(() => {
      refreshSync();
      void refetchAnswers();
    }, [refreshSync, refetchAnswers]),
  );

  if (
    !current ||
    recoveryQuery.isLoading ||
    noticesQuery.isLoading ||
    tasksQuery.isLoading ||
    sync.loading
  ) {
    return (
      <Screen withHeader testID="screen-needs-you" accessibilityLabel={copy.home.needsYouTitle}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  const deviceOrJoinCount = countDeviceOrJoinAttention({
    userId,
    admin,
    keyStatus: keyStatusQuery.data,
    notices: noticesQuery.data ?? [],
    recoveryRequests: recoveryRequestsQuery.data ?? [],
    recovery: recoveryQuery.data,
    removedNoticeCount: (removedNoticesQuery.data ?? []).length,
  });

  const syncRsvpNeeded = Boolean(
    userId &&
      sync.active?.status === 'upcoming' &&
      !(syncAnswersQuery.data ?? []).some((row) => row.userId === userId),
  );

  const items = buildNeedsYouItems({
    keyHolder,
    recoveryAccepted: recoveryQuery.data?.accepted ?? 0,
    hasPaper: Boolean(recoveryQuery.data?.hasPaper),
    recoveryStatus: recoveryQuery.data?.status,
    syncMeeting: sync.active,
    syncRsvpNeeded,
    timeZone: sync.schedule?.timezone ?? defaultTimezone(),
    userId,
    tasks: tasksQuery.data ?? [],
    deviceOrJoinCount,
  });

  return (
    <Screen withHeader testID="screen-needs-you" accessibilityLabel={copy.home.needsYouTitle}>
      <Title>{copy.home.needsYouTitle}</Title>
      {items.length === 0 ? (
        <EmptyState compact title={copy.home.needsYouEmpty} />
      ) : (
        items.map((item) => (
          <Card key={item.id} testID={`${item.testID}-card`}>
            <Title>{item.title}</Title>
            <Muted>{item.body}</Muted>
            <Button
              label={item.actionLabel}
              testID={item.testID}
              onPress={() => router.push(item.href as never)}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}
