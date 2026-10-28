import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Field,
  ListRow,
  LoadingState,
  Overline,
  Screen,
  Section,
  StatusPill,
  Title,
} from '../../ui';
import { PersonChips, personOptions, splitPersonKey, type PersonKey } from './PersonChips';
import {
  finishSyncMeeting,
  insertSyncTask,
  markAgendaDiscussed,
  upsertSyncNote,
  type SyncAgendaItemRow,
} from './syncApi';
import { syncPersonLabel } from './syncAuthor';
import {
  agendaRowBody,
  buildMeetingSummary,
  fillTemplate,
  stepTitle,
  taskBodyLine,
} from './syncLabels';
import { kindsForStep, SYNC_STEPS, type SyncStep } from './syncSchedule';
import { useAgendaItems, useSyncNotes, useSyncSpace, useSyncTasks } from './useSyncSpace';

const WRAP_UP = SYNC_STEPS.length;

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueOn: z
    .string()
    .trim()
    .refine((value) => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)))),
});

function itemsForStep(items: SyncAgendaItemRow[], step: SyncStep): SyncAgendaItemRow[] {
  const kinds = kindsForStep(step);
  return items.filter((item) => kinds.includes(item.kind));
}

export function RunSyncScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sync = useSyncSpace();
  const { userId, spaceId, active, people } = sync;
  const readOnly = Boolean(active && active.startedBy !== userId);
  const poll = readOnly ? 15000 : undefined;
  const agendaQuery = useAgendaItems(active?.id, poll);
  const notesQuery = useSyncNotes(active?.id, poll);
  const tasksQuery = useSyncTasks(spaceId);

  const [stepIndex, setStepIndex] = useState(0);
  useEffect(() => {
    if (!active?.id) {
      return;
    }
    queryClient.setQueryData(['syncFlowStep', active.id], Math.min(stepIndex, SYNC_STEPS.length - 1));
  }, [active?.id, stepIndex, queryClient]);
  const [noteDrafts, setNoteDrafts] = useState<Partial<Record<SyncStep, string>>>({});
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [owner, setOwner] = useState<PersonKey | null>(null);
  const [backup, setBackup] = useState<PersonKey | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Sync with Pressable: busy state alone can lag one frame behind a Maestro tap. */
  const opLock = useRef(false);

  const screenProps = {
    withHeader: true,
    testID: 'screen-sync-run',
    accessibilityLabel: copy.sync.title,
  } as const;

  if (sync.loading || agendaQuery.isLoading || notesQuery.isLoading) {
    return (
      <Screen {...screenProps}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (sync.failed || agendaQuery.isError || notesQuery.isError) {
    return (
      <Screen {...screenProps}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }
  if (!active || active.status !== 'in_progress') {
    return (
      <Screen {...screenProps}>
        <EmptyState
          title={copy.sync.title}
          message={copy.sync.nothingRunning}
          action={<Button label={copy.sync.backToSync} onPress={() => router.replace(routes.sync)} />}
        />
      </Screen>
    );
  }

  const meeting = active;
  const agenda = agendaQuery.data ?? [];
  const notes = notesQuery.data ?? [];
  const savedNote = (step: SyncStep) => notes.find((row) => row.step === step)?.body ?? '';
  const noteValue = (step: SyncStep) => noteDrafts[step] ?? savedNote(step);
  const meetingTasks = (tasksQuery.data ?? []).filter((task) => task.meetingId === meeting.id);

  const invalidate = (key: 'syncAgenda' | 'syncNotes' | 'syncTasks') => {
    void queryClient.invalidateQueries({
      queryKey: key === 'syncTasks' ? [key, spaceId] : [key, meeting.id],
    });
  };

  const saveNote = async (step: SyncStep) => {
    const draft = noteDrafts[step];
    if (draft === undefined || draft === savedNote(step) || !spaceId || !userId) {
      return;
    }
    await upsertSyncNote({ spaceId, meetingId: meeting.id, step, body: draft, updatedBy: userId });
    invalidate('syncNotes');
  };

  const guarded = async (run: () => Promise<void>) => {
    if (opLock.current) {
      return;
    }
    opLock.current = true;
    setError(null);
    setBusy(true);
    try {
      await run();
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.saveFailed);
    } finally {
      opLock.current = false;
      setBusy(false);
    }
  };

  if (readOnly) {
    const runner = syncPersonLabel(meeting.startedBy, people.members);
    return (
      <Screen
        {...screenProps}
        refreshing={agendaQuery.isRefetching || notesQuery.isRefetching}
        onRefresh={() => {
          sync.refresh();
          void agendaQuery.refetch();
          void notesQuery.refetch();
        }}
      >
        <Banner message={fillTemplate(copy.sync.runningOn, { name: runner })} />
        <Caption>{fillTemplate(copy.sync.followingAlong, { name: runner })}</Caption>
        {SYNC_STEPS.map((step) => {
          const items = itemsForStep(agenda, step);
          const note = savedNote(step);
          return (
            <Card key={step} variant="soft">
              <Section>{stepTitle(step)}</Section>
              {items.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  body={item.decisionText || agendaRowBody(item, people)}
                  trailing={item.discussedAt ? <StatusPill label={copy.sync.discussed} tone="success" /> : undefined}
                />
              ))}
              {note ? (
                <>
                  <Caption tone="muted">{copy.sync.notesLabel}</Caption>
                  <Body>{note}</Body>
                </>
              ) : null}
              {items.length === 0 && !note ? <Caption tone="muted">{copy.sync.nothingForStep}</Caption> : null}
            </Card>
          );
        })}
      </Screen>
    );
  }

  const onNext = () =>
    guarded(async () => {
      const step = SYNC_STEPS[stepIndex];
      if (step) {
        await saveNote(step);
      }
      const next = Math.min(stepIndex + 1, WRAP_UP);
      if (next === WRAP_UP && userId) {
        setOwner((current) => current ?? `user:${userId}`);
      }
      setStepIndex(next);
    });

  const onDiscussed = (item: SyncAgendaItemRow) =>
    guarded(async () => {
      await markAgendaDiscussed({
        id: item.id,
        decisionText: item.kind === 'decide' ? decisionDrafts[item.id] ?? item.decisionText : undefined,
      });
      invalidate('syncAgenda');
    });

  const onAddTask = () => {
    const parsed = taskSchema.safeParse({ title: taskTitle, dueOn: taskDue });
    if (!parsed.success) {
      const titleBad = parsed.error.issues.some((issue) => issue.path[0] === 'title');
      setTaskError(titleBad ? copy.sync.itemTitleError : copy.sync.dueError);
      return Promise.resolve();
    }
    const ownerKey = owner ?? (userId ? `user:${userId}` : null);
    if (!ownerKey) {
      setTaskError(copy.sync.ownerError);
      return Promise.resolve();
    }
    if (!spaceId) {
      return Promise.resolve();
    }
    if (ownerKey !== owner) {
      setOwner(ownerKey);
    }
    setTaskError(null);
    const ownerParts = splitPersonKey(ownerKey);
    const backupParts = splitPersonKey(backup);
    return guarded(async () => {
      await insertSyncTask({
        spaceId,
        meetingId: meeting.id,
        title: parsed.data.title,
        ownerUserId: ownerParts.userId,
        ownerChildId: ownerParts.childId,
        backupUserId: backupParts.userId,
        backupChildId: backupParts.childId,
        dueOn: parsed.data.dueOn === '' ? null : parsed.data.dueOn,
      });
      setTaskTitle('');
      setTaskDue('');
      setOwner(userId ? `user:${userId}` : null);
      setBackup(null);
      invalidate('syncTasks');
    });
  };

  const onFinish = () =>
    guarded(async () => {
      await finishSyncMeeting({
        meetingId: meeting.id,
        priorityText: priority.trim(),
        summary: buildMeetingSummary(agenda),
      });
      sync.refresh();
      router.replace(routes.sync);
    });

  if (stepIndex < WRAP_UP) {
    const step = SYNC_STEPS[stepIndex] as SyncStep;
    const info = copy.sync.steps[step];
    const items = itemsForStep(agenda, step);
    return (
      <Screen {...screenProps} keyboardAware>
        <Overline tone="terracotta">
          {fillTemplate(copy.sync.stepNumber, { number: String(stepIndex + 1) })}
        </Overline>
        <Title>{info.title}</Title>
        <Caption tone="muted">{info.estimate}</Caption>
        <Body>{info.prompt}</Body>
        {error ? <ErrorState message={error} /> : null}
        {items.length === 0 ? <Caption tone="muted">{copy.sync.nothingForStep}</Caption> : null}
        {items.map((item) => (
          <Card key={item.id}>
            <Body>{item.title}</Body>
            <Caption tone="muted">{agendaRowBody(item, people)}</Caption>
            {item.discussedAt ? (
              <>
                <StatusPill label={copy.sync.discussed} tone="success" />
                {item.decisionText ? <Body>{item.decisionText}</Body> : null}
              </>
            ) : (
              <>
                {item.kind === 'decide' ? (
                  <Field
                    label={copy.sync.decisionLabel}
                    placeholder={copy.sync.decisionPlaceholder}
                    value={decisionDrafts[item.id] ?? ''}
                    onChangeText={(text) => setDecisionDrafts((prev) => ({ ...prev, [item.id]: text }))}
                    multiline
                  />
                ) : null}
                <Button
                  label={copy.sync.markDiscussed}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void onDiscussed(item)}
                />
              </>
            )}
          </Card>
        ))}
        <Field
          label={copy.sync.notesLabel}
          placeholder={copy.sync.notesPlaceholder}
          value={noteValue(step)}
          onChangeText={(text) => setNoteDrafts((prev) => ({ ...prev, [step]: text }))}
          onBlur={() => void guarded(() => saveNote(step))}
          multiline
        />
        <Button label={copy.sync.nextStep} onPress={() => void onNext()} busy={busy} />
        {stepIndex > 0 ? (
          <Button
            label={copy.common.back}
            variant="ghost"
            disabled={busy}
            onPress={() => setStepIndex((index) => Math.max(index - 1, 0))}
          />
        ) : null}
      </Screen>
    );
  }

  const options = personOptions(people);
  return (
    <Screen {...screenProps} keyboardAware>
      <Title>{copy.sync.priorityLabel}</Title>
      {error ? <ErrorState message={error} /> : null}
      <Field
        label={copy.sync.priorityLabel}
        placeholder={copy.sync.priorityPlaceholder}
        value={priority}
        onChangeText={setPriority}
        multiline
      />
      <Section>{copy.sync.tasksLabel}</Section>
      {meetingTasks.map((task) => (
        <ListRow
          key={task.id}
          testID={`meeting-task-${task.id}`}
          title={task.title}
          body={taskBodyLine(task, people)}
        />
      ))}
      <Field
        label={copy.sync.taskTitleLabel}
        placeholder={copy.sync.taskTitlePlaceholder}
        value={taskTitle}
        onChangeText={setTaskTitle}
        error={taskError ?? undefined}
      />
      <PersonChips label={copy.sync.ownerLabel} options={options} value={owner} onChange={setOwner} />
      <PersonChips label={copy.sync.backupLabel} options={options} value={backup} onChange={setBackup} />
      <Field
        label={copy.sync.dueLabel}
        placeholder="2026-11-02"
        value={taskDue}
        onChangeText={setTaskDue}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Caption>{copy.sync.dueHint}</Caption>
      <Button
        label={copy.sync.addTask}
        variant="secondary"
        disabled={busy}
        onPress={() => void onAddTask()}
      />
      <Button label={copy.sync.finish} onPress={() => void onFinish()} busy={busy} />
      <Button
        label={copy.common.back}
        variant="ghost"
        disabled={busy}
        onPress={() => setStepIndex(WRAP_UP - 1)}
      />
    </Screen>
  );
}
