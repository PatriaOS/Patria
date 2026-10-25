import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert } from 'react-native';
import { z } from 'zod';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { Body, EmptyState, ErrorState, LoadingState, Screen } from '../../ui';
import { AddAgendaForm } from './AddAgendaForm';
import { deleteAgendaItem, insertAgendaItem, updateAgendaItem } from './syncApi';
import { canEditAgendaItem, circleDisplayName, fillTemplate } from './syncLabels';
import { SYNC_AGENDA_KINDS } from './syncSchedule';
import { useAgendaItems, useSyncSpace } from './useSyncSpace';

const schema = z.object({
  kind: z.enum(SYNC_AGENDA_KINDS),
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().max(2000),
  attributedChildId: z.string().nullable(),
});

type FormValues = z.infer<typeof schema>;

export function AddAgendaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ itemId?: string }>();
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const sync = useSyncSpace();
  const { userId, spaceId, admin, active, people, schedule, circlesQuery } = sync;
  const agendaQuery = useAgendaItems(active?.id);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const existing = itemId ? agendaQuery.data?.find((row) => row.id === itemId) : undefined;
  const { control, handleSubmit, reset, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: 'discuss', title: '', details: '', attributedChildId: null },
  });

  const watched = useWatch({ control });
  const values: FormValues = {
    kind: watched.kind ?? 'discuss',
    title: watched.title ?? '',
    details: watched.details ?? '',
    attributedChildId: watched.attributedChildId ?? null,
  };

  useEffect(() => {
    if (existing) {
      reset({
        kind: existing.kind,
        title: existing.title,
        details: existing.details,
        attributedChildId: existing.attributedChildId,
      });
    }
  }, [existing, reset]);

  if (sync.loading || (itemId && agendaQuery.isLoading)) {
    return (
      <Screen withHeader testID="screen-sync-agenda" accessibilityLabel={copy.sync.addToAgenda}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (sync.failed || agendaQuery.isError) {
    return (
      <Screen withHeader testID="screen-sync-agenda" accessibilityLabel={copy.sync.addToAgenda}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }
  if (!active) {
    return (
      <Screen withHeader testID="screen-sync-agenda" accessibilityLabel={copy.sync.addToAgenda}>
        <EmptyState title={copy.sync.title} message={copy.sync.noMeetingToAdd} />
      </Screen>
    );
  }
  if (itemId && !existing) {
    return (
      <Screen withHeader testID="screen-sync-agenda" accessibilityLabel={copy.sync.editAgendaTitle}>
        <EmptyState title={copy.sync.title} message={copy.common.error} />
      </Screen>
    );
  }
  if (existing && !canEditAgendaItem(existing, userId, admin)) {
    return (
      <Screen withHeader testID="screen-sync-agenda" accessibilityLabel={copy.sync.editAgendaTitle}>
        <Body>{copy.sync.cantEditItem}</Body>
      </Screen>
    );
  }

  const finish = () => {
    sync.refresh();
    router.replace(routes.sync);
  };

  const onDelete = () => {
    if (!existing) {
      return;
    }
    Alert.alert(copy.sync.delete, copy.sync.deleteConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.sync.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            try {
              await deleteAgendaItem(existing.id);
              finish();
            } catch (caught) {
              logFailedAction(caught);
              setFormError(copy.sync.saveFailed);
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  };

  const addedByOptions = people.children.map((child) => ({ id: child.id, label: child.displayName }));

  const onSave = handleSubmit(
    async (input) => {
      if (!spaceId || !userId) {
        return;
      }
      setFormError(null);
      setSaving(true);
      try {
        if (existing) {
          await updateAgendaItem({
            id: existing.id,
            kind: input.kind,
            title: input.title,
            details: input.details,
            attributedChildId: admin ? input.attributedChildId : existing.attributedChildId,
          });
        } else {
          await insertAgendaItem({
            spaceId,
            meetingId: active.id,
            kind: input.kind,
            title: input.title,
            details: input.details,
            authorUserId: userId,
            attributedChildId: admin ? input.attributedChildId : null,
          });
        }
        finish();
      } catch (caught) {
        logFailedAction(caught);
        setFormError(copy.sync.saveFailed);
      } finally {
        setSaving(false);
      }
    },
    () => setFormError(null),
  );

  const self = people.members.find((member) => member.userId === userId);
  const selfName = self?.displayName ?? copy.member.fallbackName;
  const circle = circlesQuery.data?.find((row) => row.id === (active.circleId ?? schedule?.circleId));
  const dayName =
    schedule != null
      ? copy.sync.weekdaysLong[schedule.weekday] ?? copy.sync.weekdaysLong[0]
      : copy.sync.weekdaysLong[0];
  const meetingSubtitle = fillTemplate(copy.sync.forMeeting, {
    day: dayName,
    circle: circleDisplayName(circle),
  });

  return (
    <Screen
      withHeader
      keyboardAware
      testID="screen-sync-agenda"
      accessibilityLabel={existing ? copy.sync.editAgendaTitle : copy.sync.addToAgenda}
    >
      <AddAgendaForm
        kind={values.kind}
        title={values.title}
        details={values.details}
        titleError={Boolean(formState.errors.title)}
        addedById={values.attributedChildId}
        addedByOptions={addedByOptions}
        selfLabel={fillTemplate(copy.sync.addedByYou, { name: selfName })}
        selfId={userId ?? 'self'}
        showAddedBy={admin && addedByOptions.length > 0}
        editing={Boolean(existing)}
        busy={saving}
        error={formError}
        meetingSubtitle={meetingSubtitle}
        onKind={(kind) => setValue('kind', kind)}
        onTitle={(value) => setValue('title', value, { shouldValidate: formState.isSubmitted })}
        onDetails={(value) => setValue('details', value)}
        onAddedBy={(id) => setValue('attributedChildId', id)}
        onSave={() => void onSave()}
        onCancel={() => router.back()}
        onDelete={onDelete}
      />
    </Screen>
  );
}
