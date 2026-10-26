import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { isMemoryRole } from '../../lib/roles';
import { Card, Muted } from '../../ui';
import { fetchReadyMemories } from '../memories/memoryApi';
import { agendaBodyLine, setTaskDone, type SyncTaskRow } from '../sync/syncApi';
import { homeSyncMeetingTitle, homeSyncOverline } from '../sync/syncHome';
import { circleDisplayName, defaultTimezone, isMissed } from '../sync/syncLabels';
import { nextMeetingAt } from '../sync/syncSchedule';
import { useAgendaItems, useSyncSpace, useSyncTasks } from '../sync/useSyncSpace';
import { HomeSyncCard } from './HomeSyncCard';
import { OnThisDayCard } from './OnThisDayCard';
import { pickOnThisDay } from './onThisDay';
import { ThisWeekTasks } from './ThisWeekTasks';

/** Sync hero, On this day and This week for Home Today (D35). Reads only; nothing here acts without a tap. */
export function HomeToday() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, current, schedule, active, people, circlesQuery } = sync;
  const agendaQuery = useAgendaItems(active?.id);
  const tasksQuery = useSyncTasks(spaceId);
  const memoriesQuery = useQuery({
    queryKey: ['memories', spaceId],
    enabled: Boolean(spaceId) && isMemoryRole(current?.role),
    queryFn: () => fetchReadyMemories(spaceId as string),
  });
  const [toggleError, setToggleError] = useState<string | null>(null);

  const timeZone = schedule?.timezone ?? defaultTimezone();
  const now = new Date();

  const onToggle = async (task: SyncTaskRow) => {
    if (!userId) {
      return;
    }
    setToggleError(null);
    try {
      await setTaskDone({ id: task.id, done: !task.doneAt, doneBy: userId });
      await queryClient.invalidateQueries({ queryKey: ['syncTasks', spaceId] });
    } catch (caught) {
      logFailedAction(caught);
      setToggleError(copy.sync.saveFailed);
    }
  };

  let hero = null;
  if (sync.loading) {
    hero = (
      <Card variant="soft" testID="home-sync-loading">
        <Muted>{copy.home.syncLoading}</Muted>
      </Card>
    );
  } else if (sync.failed) {
    hero = (
      <Card variant="soft" testID="home-sync-error">
        <Muted>{copy.home.syncFailed}</Muted>
      </Card>
    );
  } else {
    const circle = circlesQuery.data?.find(
      (row) => row.id === (active?.circleId ?? schedule?.circleId),
    );
    // Prefer nextMeetingAt from the schedule (real clock + family TZ) so a finished
    // Sunday meeting rolls to IN 7 DAYS; in-progress keeps today's meeting for HAPPENING NOW.
    const scheduledFor =
      active?.status === 'in_progress'
        ? new Date(active.scheduledFor)
        : schedule
          ? nextMeetingAt(schedule, now)
          : active
            ? new Date(active.scheduledFor)
            : null;
    const overlineStatus = active?.status === 'in_progress' ? 'in_progress' : 'upcoming';
    let body: string = copy.sync.noMeetingYet;
    if (active) {
      if (isMissed(active, now)) {
        body = copy.sync.missedNoGuilt;
      } else if (agendaQuery.isLoading) {
        body = copy.common.loading;
      } else {
        body = agendaBodyLine(agendaQuery.data ?? []);
      }
    }
    hero = (
      <HomeSyncCard
        admin={admin}
        hasSchedule={Boolean(schedule && scheduledFor)}
        overline={
          scheduledFor
            ? homeSyncOverline(
                { scheduledFor, status: overlineStatus },
                timeZone,
                now,
              )
            : ''
        }
        title={homeSyncMeetingTitle(circleDisplayName(circle))}
        body={body}
        canAddItem={Boolean(active)}
        onSetUp={() => router.push(routes.syncSchedule)}
        onReview={() => router.push(routes.sync)}
        onAddItem={() => router.push(routes.syncAgenda())}
      />
    );
  }

  const onThisDay = memoriesQuery.data ? pickOnThisDay(memoriesQuery.data, timeZone, now) : null;

  return (
    <>
      {hero}
      {onThisDay ? (
        <OnThisDayCard pick={onThisDay} onOpen={(id) => router.push(routes.memoryItem(id))} />
      ) : null}
      <ThisWeekTasks
        tasks={tasksQuery.data ?? []}
        people={people}
        userId={userId}
        admin={admin}
        timeZone={timeZone}
        loading={tasksQuery.isLoading}
        failed={tasksQuery.isError}
        toggleError={toggleError}
        now={now}
        onToggle={(task) => void onToggle(task)}
        onSeeAll={() => router.push(routes.syncTasks)}
      />
    </>
  );
}
