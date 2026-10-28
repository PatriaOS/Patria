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
import {
  addOrUpdateSyncCalendarEvent,
  calendarNeedsNewTimeLabel,
} from './syncCalendar';
import {
  agendaRowBody,
  canEditAgendaItem,
  circleDisplayName,
  isMissed,
  kindLabel,
} from './syncLabels';
import { syncPersonLabel } from './syncAuthor';
import { syncAnswersKey } from './syncQueryKeys';
import {
  formatMeetingWhen,
  syncCountdown,
  syncFlowTitle,
  syncStartKind,
  syncStartTestId,
  weekdayLong,
} from './syncSchedule';
import { SyncHubView } from './SyncHubView';
import { SyncStartEarlySheet } from './SyncStartEarlySheet';
import { useAgendaItems, useSyncSpace } from './useSyncSpace';

export function SyncScreen() {
  const router = useRouter();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, schedule, active, people, circlesQuery, refresh } = sync;
  const agendaQuery = useAgendaItems(active?.id);
  const activeMeetingId = active?.id;
  const answersQuery = useQuery({
    queryKey: syncAnswersKey(activeMeetingId),
    enabled: Boolean(activeMeetingId && active?.status === 'upcoming'),
    queryFn: () => fetchSyncMeetingAnswers(activeMeetingId as string),
  });
  const circleMembersQuery = useQuery({
    queryKey: ['syncCircleMembers', active?.circleId ?? 'none'],
    enabled: Boolean(active?.circleId && admin),
    queryFn: () => fetchCircleMemberIds(active!.circleId),
  });
  // Depend only on stable values. Never put a useQuery result object here — its
  // identity changes on every fetch and re-fires focus refresh in a loop (D37).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      refresh();
      await Promise.all([agendaQuery.refetch(), answersQuery.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
    // refetch functions are stable; the query objects are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [refresh, agendaQuery.refetch, answersQuery.refetch]);
  const flowStepQuery = useQuery({
    queryKey: ['syncFlowStep', active?.id ?? 'none'],
    queryFn: async () => 0,
    enabled: Boolean(active?.id),
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const [calendarNeedsNewTime, setCalendarNeedsNewTime] = useState(false);
  const [earlyConfirmOpen, setEarlyConfirmOpen] = useState(false);
  const ensureKey = useRef<string | null>(null);
  const calendarMeetingKey = active?.id && active.scheduledFor ? `${active.id}:${active.scheduledFor}` : null;

  useEffect(() => {
    if (!active?.id || !userId || !spaceId || !active.scheduledFor) {
      return;
    }
    const meetingId = active.id;
    const when = new Date(active.scheduledFor);
    let cancelled = false;
    void calendarNeedsNewTimeLabel({
      userId,
      spaceId,
      meetingId,
      scheduledFor: when,
    }).then((needsNew) => {
      if (!cancelled) {
        setCalendarNeedsNewTime(needsNew);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [calendarMeetingKey, userId, spaceId, calendarNotice, active?.id, active?.scheduledFor]);

  const calendarButtonLabel =
    Boolean(calendarMeetingKey) && calendarNeedsNewTime
      ? copy.sync.calendarAddNewTime
      : copy.sync.addToCalendar;

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
  const startKind =
    active && admin && (!inProgress || active.startedBy === userId)
      ? syncStartKind({
          status: active.status,
          scheduledFor: new Date(active.scheduledFor),
          timeZone: zone,
          missed,
        })
      : null;
  const startLabel =
    startKind === 'start_early'
      ? copy.sync.startEarly
      : startKind === 'start_today'
        ? copy.sync.startTheSync
        : startKind === 'continue'
          ? copy.sync.continue
          : startKind === 'hold_now'
            ? copy.sync.holdItNow
            : null;

  const onStartMeeting = async () => {
    if (!active) {
      return;
    }
    setError(null);
    setEarlyConfirmOpen(false);
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

  const onStartOrResume = () => {
    if (!active) {
      return;
    }
    setError(null);
    if (active.status === 'in_progress') {
      router.push(routes.syncRun);
      return;
    }
    if (startKind === 'start_early') {
      setEarlyConfirmOpen(true);
      return;
    }
    void onStartMeeting();
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
    if (!active || !userId || !spaceId || !scheduledFor || !schedule) {
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
        schedule: {
          frequency: schedule.frequency,
          weekday: schedule.weekday,
          monthlyMode: schedule.monthlyMode,
          monthlyOrdinal: schedule.monthlyOrdinal,
          monthDay: schedule.monthDay,
        },
      });
      if (result.ok) {
        setCalendarNotice(
          result.replacedPrior ? copy.sync.calendarAddedReplaceOld : copy.sync.calendarAdded,
        );
      } else if (result.reason === 'canceled') {
        // Person closed the system sheet — show nothing.
        setCalendarNotice(null);
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
      refreshing={pullRefreshing}
      onRefresh={() => {
        void onPullRefresh();
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
        flowTitle={scheduledFor ? syncFlowTitle(scheduledFor, zone) : copy.sync.tonightFlow}
        startKind={startKind}
        startLabel={startLabel}
        startTestId={startKind ? syncStartTestId(startKind) : null}
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
        calendarButtonLabel={calendarButtonLabel}
        onSetUp={() => router.push(routes.syncSchedule)}
        onStart={() => onStartOrResume()}
        onHoldNow={() => void onStartMeeting()}
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
      <SyncStartEarlySheet
        visible={earlyConfirmOpen}
        weekday={scheduledFor ? weekdayLong(scheduledFor, zone) : ''}
        whenLabel={scheduledFor ? formatMeetingWhen(scheduledFor, zone) : ''}
        circleName={circleDisplayName(circle)}
        onConfirm={() => void onStartMeeting()}
        onCancel={() => setEarlyConfirmOpen(false)}
      />
    </Screen>
  );
}
