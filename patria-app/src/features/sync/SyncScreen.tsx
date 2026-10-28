import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { ErrorState, LoadingState, Screen, Button } from '../../ui';
import { fetchCircleMemberIds } from '../memories/memoryApi';
import {
  ensureNextMeeting,
  fetchSyncMeetingAnswers,
  setSyncMeetingAnswer,
  startSyncMeeting,
  upsertSyncSchedule,
  type SyncRsvp,
} from './syncApi';
import { addOrUpdateSyncCalendarEvent } from './syncCalendar';
import {
  agendaRowBody,
  canEditAgendaItem,
  circleDisplayName,
  isMissed,
  kindLabel,
} from './syncLabels';
import { syncPersonLabel } from './syncAuthor';
import { formatMeetingWhen, syncCountdown } from './syncSchedule';
import { SyncHubView } from './SyncHubView';
import { useAgendaItems, useSyncSpace } from './useSyncSpace';

export function SyncScreen() {
  const router = useRouter();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, schedule, active, people, circlesQuery, refresh } = sync;
  const agendaQuery = useAgendaItems(active?.id);
  const answersQuery = useQuery({
    queryKey: ['syncAnswers', active?.id ?? 'none'],
    enabled: Boolean(active?.id && active.status === 'upcoming'),
    queryFn: () => fetchSyncMeetingAnswers(active!.id),
  });
  const circleMembersQuery = useQuery({
    queryKey: ['syncCircleMembers', active?.circleId ?? 'none'],
    enabled: Boolean(active?.circleId && admin),
    queryFn: () => fetchCircleMemberIds(active!.circleId),
  });
  useFocusEffect(
    useCallback(() => {
      refresh();
      void answersQuery.refetch();
    }, [refresh, answersQuery]),
  );
  const flowStepQuery = useQuery({
    queryKey: ['syncFlowStep', active?.id ?? 'none'],
    queryFn: async () => 0,
    enabled: Boolean(active?.id),
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const ensureKey = useRef<string | null>(null);

  const scheduleReady = Boolean(schedule);
  const meetingsLoaded = sync.meetingsQuery.isSuccess;
  const meetingCount = sync.meetings.length;
  const hasActive = Boolean(active);

  useEffect(() => {
    if (!admin || !spaceId || !scheduleReady || !meetingsLoaded || hasActive) {
      return;
    }
    const key = `${spaceId}:${meetingCount}`;
    if (ensureKey.current === key) {
      return;
    }
    ensureKey.current = key;
    void (async () => {
      try {
        await ensureNextMeeting(spaceId);
        refresh();
      } catch (caught) {
        logFailedAction(caught);
        ensureKey.current = null;
      }
    })();
  }, [admin, spaceId, scheduleReady, meetingsLoaded, hasActive, meetingCount, refresh]);

  const answers = useMemo(() => answersQuery.data ?? [], [answersQuery.data]);
  const myAnswer = useMemo(
    () => answers.find((row) => row.userId === userId)?.answer ?? null,
    [answers, userId],
  );
  const goingNames = useMemo(
    () =>
      answers
        .filter((row) => row.answer === 'going')
        .map((row) => syncPersonLabel(row.userId, people.members)),
    [answers, people.members],
  );
  const cantNames = useMemo(
    () =>
      answers
        .filter((row) => row.answer === 'cant')
        .map((row) => syncPersonLabel(row.userId, people.members)),
    [answers, people.members],
  );
  const unansweredNames = useMemo(() => {
    if (!admin || !active || active.status !== 'upcoming') {
      return [];
    }
    const answered = new Set(answers.map((row) => row.userId));
    const circleIds = new Set(circleMembersQuery.data ?? []);
    return people.members
      .filter((member) => circleIds.has(member.userId) && !answered.has(member.userId))
      .map((member) => syncPersonLabel(member.userId, people.members));
  }, [admin, active, answers, people.members, circleMembersQuery.data]);

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
  const canReply =
    Boolean(active && active.status === 'upcoming' && !missed && scheduledFor && scheduledFor > new Date());

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
        frequency: schedule.frequency,
        monthlyMode: schedule.monthlyMode,
        monthlyOrdinal: schedule.monthlyOrdinal,
        monthDay: schedule.monthDay,
      });
      refresh();
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const onAnswer = async (answer: SyncRsvp) => {
    if (!active) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setSyncMeetingAnswer(active.id, answer);
      await answersQuery.refetch();
      refresh();
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const onAddToCalendar = async () => {
    if (!active || !userId || !spaceId || !scheduledFor) {
      return;
    }
    setCalendarNotice(null);
    setBusy(true);
    try {
      const result = await addOrUpdateSyncCalendarEvent({
        userId,
        spaceId,
        meetingId: active.id,
        scheduledFor,
      });
      if (result.ok) {
        setCalendarNotice(copy.sync.calendarAdded);
      } else if (result.reason === 'denied') {
        setCalendarNotice(copy.sync.calendarPermissionBody);
      } else {
        setCalendarNotice(copy.sync.saveFailed);
      }
    } catch (caught) {
      logFailedAction(caught);
      setCalendarNotice(copy.sync.saveFailed);
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
      refreshing={sync.refreshing || agendaQuery.isRefetching || answersQuery.isRefetching}
      onRefresh={() => {
        refresh();
        void agendaQuery.refetch();
        void answersQuery.refetch();
      }}
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
        canReply={canReply}
        myAnswer={myAnswer}
        goingNames={goingNames}
        cantNames={cantNames}
        unansweredNames={unansweredNames}
        calendarNotice={calendarNotice}
        onSetUp={() => router.push(routes.syncSchedule)}
        onContinue={() => void onStartOrResume()}
        onHoldNow={() => void onStartOrResume()}
        onNextDate={() => void onNextDate()}
        onFollow={() => router.push(routes.syncRun)}
        onAddAgenda={() => router.push(routes.syncAgenda())}
        onSchedule={() => router.push(routes.syncSchedule)}
        onMoveMeeting={() => router.push(routes.syncMove)}
        onPast={() => router.push(routes.syncPast)}
        onTasks={() => router.push(routes.syncTasks)}
        onOpenItem={(id) => router.push(routes.syncAgenda(id))}
        onAnswerGoing={() => void onAnswer('going')}
        onAnswerCant={() => void onAnswer('cant')}
        onAddToCalendar={() => void onAddToCalendar()}
      />
    </Screen>
  );
}
