import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Section,
  StatusPill,
} from '../../ui';
import { setTaskDone, type SyncTaskRow } from './syncApi';
import { canToggleTask, taskBodyLine } from './syncLabels';
import { useSyncSpace, useSyncTasks } from './useSyncSpace';

function sortTasks(tasks: SyncTaskRow[]): SyncTaskRow[] {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.doneAt) !== Boolean(b.doneAt)) {
      return a.doneAt ? 1 : -1;
    }
    return (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999');
  });
}

export function SyncTasksScreen() {
  const queryClient = useQueryClient();
  const sync = useSyncSpace();
  const { userId, spaceId, admin, people } = sync;
  const tasksQuery = useSyncTasks(spaceId);
  const [error, setError] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const screenProps = {
    withHeader: true,
    testID: 'screen-sync-tasks',
    accessibilityLabel: copy.sync.thisWeek,
  } as const;

  if (sync.loading || tasksQuery.isLoading) {
    return (
      <Screen {...screenProps}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (sync.failed || tasksQuery.isError) {
    return (
      <Screen {...screenProps}>
        <ErrorState message={copy.common.error} />
        <Button
          label={copy.common.tryAgain}
          variant="secondary"
          onPress={() => void tasksQuery.refetch()}
        />
      </Screen>
    );
  }

  const tasks = sortTasks(tasksQuery.data ?? []);
  const onToggle = async (task: SyncTaskRow) => {
    if (!userId) {
      return;
    }
    setError(null);
    try {
      await setTaskDone({ id: task.id, done: !task.doneAt, doneBy: userId });
      await queryClient.invalidateQueries({ queryKey: ['syncTasks', spaceId] });
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.saveFailed);
    }
  };

  return (
    <Screen
      {...screenProps}
      refreshing={pullRefreshing}
      onRefresh={() => {
        setPullRefreshing(true);
        void tasksQuery.refetch().finally(() => setPullRefreshing(false));
      }}
    >
      <Section>{copy.sync.thisWeek}</Section>
      {error ? <ErrorState message={error} /> : null}
      {tasks.length === 0 ? (
        <EmptyState title={copy.sync.tasks} message={copy.sync.noTasks} compact />
      ) : (
        tasks.map((task) => (
          <ListRow
            key={task.id}
            title={task.title}
            body={taskBodyLine(task, people)}
            trailing={
              task.doneAt ? <StatusPill label={copy.sync.done} tone="success" /> : undefined
            }
            onPress={canToggleTask(task, userId, admin) ? () => void onToggle(task) : undefined}
          />
        ))
      )}
    </Screen>
  );
}
