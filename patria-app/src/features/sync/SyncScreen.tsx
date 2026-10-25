import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { ErrorState, LoadingState, Screen, Button } from '../../ui';
import {
  ensureNextMeeting,
  startSyncMeeting,
  upsertSyncSchedule,
} from './syncApi';
import {
  agendaRowBody,
  canEditAgendaItem,
  circleDisplayName,
  isMissed,
  kindLabel,
} from './syncLabels';
import { syncPersonLabel } from './syncAuthor';
import { formatMeetingWhen, nextMeetingAt, syncCountdown } from './syncSchedule';
import { SyncHubView } from './SyncHubView';
import { useAgendaItems, useSyncSpace } from './useSyncSpace';

export function SyncScreen() {
  const router = useRouter();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, schedule, active, people, circlesQuery, refresh } = sync;
  const agendaQuery = useAgendaItems(active?.id);
  const flowStepQuery = useQuery({
    queryKey: ['syncFlowStep', active?.id ?? 'none'],
    queryFn: async () => 0,
    enabled: Boolean(active?.id),
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ensureKey = useRef<string | null>(null);

  const scheduleReady = Boolean(schedule);
  const meetingsLoaded = sync.meetingsQuery.isSuccess;
  const meetingCount = sync.meetings.length;
  const hasActive = Boolean(active);
  const weekday = schedule?.weekday;
  const localTime = schedule?.localTime;
  const timezone = schedule?.timezone;

  // Admins make sure there is always a next meeting; ensure_next_meeting is idempotent.
  useEffect(() => {
    if (!admin || !spaceId || !scheduleReady || !meetingsLoaded || hasActive) {
      return;
    }
    if (weekday === undefined || !localTime || !timezone) {
      return;
    }
    const key = `${spaceId}:${weekday}:${localTime}:${timezone}:${meetingCount}`;
    if (ensureKey.current === key) {
      return;
    }
    ensureKey.current = key;
    void (async () => {
      try {
        await ensureNextMeeting(spaceId, nextMeetingAt({ weekday, localTime, timezone }));
        refresh();
      } catch (caught) {
        logFailedAction(caught);
        ensureKey.current = null;
      }
    })();
  }, [admin, spaceId, scheduleReady, meetingsLoaded, hasActive, weekday, localTime, timezone, meetingCount, refresh]);

  if (sync.loading) {
    return (
      <Screen withTabBar testID="screen-sync" accessibilityLabel={copy.sync.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (sync.failed) {
    return (
      <Screen withTabBar testID="screen-sync" accessibilityLabel={copy.sync.title}>
        <ErrorState message={copy.common.error} />
        <Button label={copy.common.tryAgain} variant="secondary" onPress={refresh} />
      </Screen>
    );
  }

  const circle = circlesQuery.data?.find((row) => row.id === (active?.circleId ?? schedule?.circleId));
  const scheduledFor = active ? new Date(active.scheduledFor) : null;
  const zone = schedule?.timezone ?? 'UTC';
  const inProgress = active?.status === 'in_progress';
  const runningElsewhere = inProgress && active.startedBy !== userId;
  const missed = active ? isMissed(active, new Date()) : false;

  const onStartOrResume = async () => {
    if (!active) {
      return;
    }
    setError(null);
    if (active.status === 'in_progress') {
      router.push(routes.syncRun);
      return;
    }
    setBusy(true);
    try {
      await startSyncMeeting(active.id);
      refresh();
      router.push(routes.syncRun);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.startFailed);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const onNextDate = async () => {
    if (!schedule || !spaceId) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await upsertSyncSchedule({
        spaceId,
        weekday: schedule.weekday,
        localTime: schedule.localTime,
        timezone: schedule.timezone,
        circleId: schedule.circleId,
        nextScheduledFor: nextMeetingAt(schedule),
      });
      refresh();
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const agenda = (agendaQuery.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    body: agendaRowBody(item, people),
    kind: item.kind,
    kindLabel: kindLabel(item.kind),
    editable: canEditAgendaItem(item, userId, admin),
  }));

  return (
    <Screen
      withTabBar
      testID="screen-sync"
      accessibilityLabel={copy.sync.title}
      refreshing={sync.refreshing || agendaQuery.isRefetching}
      onRefresh={refresh}
    >
      <SyncHubView
        admin={admin}
        hasSchedule={Boolean(schedule)}
        hasMeeting={Boolean(active)}
        circleName={circleDisplayName(circle)}
        whenLabel={scheduledFor ? formatMeetingWhen(scheduledFor, zone) : ''}
        countdown={
          scheduledFor && active?.status === 'upcoming' && !missed
            ? syncCountdown(scheduledFor, zone)
            : null
        }
        canContinue={admin && (!inProgress || active?.startedBy === userId)}
        missed={missed}
        runnerName={runningElsewhere ? syncPersonLabel(active?.startedBy, people.members) : null}
        flowStepIndex={inProgress ? (flowStepQuery.data ?? 0) : null}
        agenda={agenda}
        busy={busy}
        error={error}
        onSetUp={() => router.push(routes.syncSchedule)}
        onContinue={() => void onStartOrResume()}
        onHoldNow={() => void onStartOrResume()}
        onNextDate={() => void onNextDate()}
        onFollow={() => router.push(routes.syncRun)}
        onAddAgenda={() => router.push(routes.syncAgenda())}
        onSchedule={() => router.push(routes.syncSchedule)}
        onPast={() => router.push(routes.syncPast)}
        onTasks={() => router.push(routes.syncTasks)}
        onOpenItem={(id) => router.push(routes.syncAgenda(id))}
      />
    </Screen>
  );
}
