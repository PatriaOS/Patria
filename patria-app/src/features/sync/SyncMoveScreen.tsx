import { useRouter } from 'expo-router';
import { useState } from 'react';

import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import {
  Body,
  Button,
  Caption,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Screen,
} from '../../ui';
import { moveSyncMeeting } from './syncApi';
import { useSyncSpace } from './useSyncSpace';

/** Parse `YYYY-MM-DD HH:MM` as a local wall time → Date. */
function parseMoveInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return null;
  }
  return date;
}

function defaultMoveValue(scheduledFor: string): string {
  const date = new Date(scheduledFor);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

export function SyncMoveScreen() {
  const router = useRouter();
  const sync = useSyncSpace();
  const { admin, active } = sync;
  const [value, setValue] = useState(() =>
    active?.status === 'upcoming' ? defaultMoveValue(active.scheduledFor) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sync.loading) {
    return (
      <Screen withHeader testID="screen-sync-move" accessibilityLabel={copy.sync.moveThisMeeting}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!admin || !active || active.status !== 'upcoming') {
    return (
      <Screen withHeader testID="screen-sync-move" accessibilityLabel={copy.sync.moveThisMeeting}>
        <EmptyState title={copy.sync.moveThisMeeting} message={copy.sync.scheduleReadOnly} />
        <Button label={copy.sync.backToSync} onPress={() => router.replace(routes.sync)} />
      </Screen>
    );
  }

  const onMove = async () => {
    const next = parseMoveInput(value);
    if (!next) {
      setError(copy.sync.moveDateError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await moveSyncMeeting(active.id, next);
      sync.refresh();
      router.replace(routes.sync);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.sync.moveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      withHeader
      keyboardAware
      testID="screen-sync-move"
      accessibilityLabel={copy.sync.moveThisMeeting}
    >
      <Body>{copy.sync.moveThisMeetingBody}</Body>
      <Caption>{copy.sync.moveDateHint}</Caption>
      {error ? <ErrorState message={error} /> : null}
      <Field
        label={copy.sync.moveDateLabel}
        testID="move-datetime"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="2026-11-02 19:00"
      />
      <Button
        label={copy.sync.moveConfirm}
        testID="move-confirm"
        busy={busy}
        onPress={() => void onMove()}
      />
    </Screen>
  );
}
