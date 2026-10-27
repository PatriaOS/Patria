import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { isMemoryRole, isVaultWriterRole } from '../../lib/roles';
import { Card, Muted, Title } from '../../ui';
import { fetchReadyMemories } from '../memories/memoryApi';
import { agendaBodyLine, setTaskDone, type SyncTaskRow } from '../sync/syncApi';
import { homeSyncMeetingTitle, homeSyncOverline } from '../sync/syncHome';
import { circleDisplayName, defaultTimezone, isMissed } from '../sync/syncLabels';
import { nextMeetingAt } from '../sync/syncSchedule';
import { useAgendaItems, useSyncSpace, useSyncTasks } from '../sync/useSyncSpace';
import { HomeMemoriesCard } from './HomeMemoriesCard';
import { HomeSyncCard } from './HomeSyncCard';
import { HomeVaultCard } from './HomeVaultCard';
import { HomeVoiceCard } from './HomeVoiceCard';
import { pickOnThisDay } from './onThisDay';
import { ThisWeekTasks } from './ThisWeekTasks';
import { useHomeVaultPeek } from './useHomeVaultPeek';

/** Body cards for Home: Sync, This week, voice, Memories (with On this day), Vault. */
export function HomeToday() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, current, schedule, active, people, circlesQuery, keyHolder } =
    sync;
  const agendaQuery = useAgendaItems(active?.id);
  const tasksQuery = useSyncTasks(spaceId);
  const memoriesQuery = useQuery({
    queryKey: ['memories', spaceId],
    enabled: Boolean(spaceId) && isMemoryRole(current?.role),
    queryFn: () => fetchReadyMemories(spaceId as string),
  });
  const vaultPeek = useHomeVaultPeek({
    spaceId: spaceId ?? undefined,
    userId: userId ?? undefined,
    role: current?.role,
    keyHolder: Boolean(keyHolder),
  });
  const [toggleError, setToggleError] = useState<string | null>(null);

  const timeZone = schedule?.timezone ?? defaultTimezone();
  const now = new Date();
  const canAddAgenda = Boolean(userId) && (admin || Boolean(active));
  const canWriteVault = isVaultWriterRole(current?.role) && !vaultPeek.locked;
  const canMemories = isMemoryRole(current?.role);

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
      <Card tone="hero" testID="home-sync-loading">
        <Muted>{copy.home.syncLoading}</Muted>
      </Card>
    );
  } else if (sync.failed) {
    hero = (
      <Card tone="hero" testID="home-sync-error">
        <Muted>{copy.home.syncFailed}</Muted>
      </Card>
    );
  } else {
    const circle = circlesQuery.data?.find(
      (row) => row.id === (active?.circleId ?? schedule?.circleId),
    );
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
            ? homeSyncOverline({ scheduledFor, status: overlineStatus }, timeZone, now)
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

  const onThisDay =
    memoriesQuery.data && canMemories
      ? pickOnThisDay(memoriesQuery.data, timeZone, now)
      : null;

  return (
    <>
      {hero}
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
        canAdd={canAddAgenda}
        onToggle={(task) => void onToggle(task)}
        onSeeAll={() => router.push(routes.syncTasks)}
        onAdd={() =>
          router.push(active ? routes.syncAgenda() : admin ? routes.syncSchedule : routes.sync)
        }
      />
      <HomeVoiceCard
        peek={vaultPeek.voice}
        loading={vaultPeek.loading}
        failed={vaultPeek.failed}
        canRecord={canWriteVault}
        spaceId={spaceId ?? undefined}
        onRecord={() => router.push(routes.vaultNew)}
        onOpenVault={() => router.push(routes.vault)}
        onRetry={vaultPeek.refetch}
      />
      {canMemories ? (
        <HomeMemoriesCard
          items={memoriesQuery.data ?? []}
          onThisDay={onThisDay}
          loading={memoriesQuery.isLoading}
          failed={memoriesQuery.isError}
          canAdd
          onOpen={(id) => router.push(routes.memoryItem(id))}
          onSeeAll={() => router.push(routes.memories)}
          onAdd={() => router.push(routes.memoriesConnect)}
          onRetry={() => void memoriesQuery.refetch()}
          onOpenOnThisDay={(id) => router.push(routes.memoryItem(id))}
        />
      ) : (
        <Card tone="surface" testID="home-memories-empty">
          <Title>{copy.home.memoriesCardEmptyTitle}</Title>
          <Muted>{copy.home.memoriesCardAskAdmin}</Muted>
        </Card>
      )}
      <HomeVaultCard
        peek={vaultPeek.vault}
        loading={vaultPeek.loading}
        failed={vaultPeek.failed}
        canAdd={canWriteVault}
        onAdd={() => router.push(routes.vaultNew)}
        onOpenVault={() => router.push(routes.vault)}
        onRetry={vaultPeek.refetch}
      />
    </>
  );
}
