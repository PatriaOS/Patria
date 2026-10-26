export type HomeAttentionKind =
  | 'recovery_setup'
  | 'device_or_join'
  | 'sync_due'
  | 'overdue_tasks'
  | 'failed_retry';

export type HomeAttentionItem = {
  id: string;
  kind: HomeAttentionKind;
  rank: number;
};

const RANK: Record<HomeAttentionKind, number> = {
  recovery_setup: 1,
  device_or_join: 2,
  sync_due: 3,
  overdue_tasks: 4,
  failed_retry: 5,
};

/** Ranked attention items; lower rank is more important. Stable by id within a rank. */
export function rankHomeAttention(items: Omit<HomeAttentionItem, 'rank'>[]): HomeAttentionItem[] {
  return items
    .map((item) => ({ ...item, rank: RANK[item.kind] }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

export const HOME_ATTENTION_VISIBLE = 2;

export function visibleHomeAttention<T extends { id: string }>(
  ranked: T[],
): { shown: T[]; hiddenCount: number } {
  const shown = ranked.slice(0, HOME_ATTENTION_VISIBLE);
  return { shown, hiddenCount: Math.max(0, ranked.length - shown.length) };
}

/** True when a Sync meeting is in progress or scheduled for today in the family zone. */
export function syncNeedsAttentionToday(
  meeting: { status: string; scheduledFor: string } | null | undefined,
  timeZone: string,
  now = new Date(),
): boolean {
  if (!meeting) {
    return false;
  }
  if (meeting.status === 'in_progress') {
    return true;
  }
  if (meeting.status !== 'upcoming') {
    return false;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) {
    return false;
  }
  const today = `${y}-${m}-${d}`;
  const meetingParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(meeting.scheduledFor));
  const my = meetingParts.find((p) => p.type === 'year')?.value;
  const mm = meetingParts.find((p) => p.type === 'month')?.value;
  const md = meetingParts.find((p) => p.type === 'day')?.value;
  return Boolean(my && mm && md && `${my}-${mm}-${md}` === today);
}

/** Open Sync tasks assigned to this user with a due date before today (YYYY-MM-DD). */
export function overdueTasksForUser(
  tasks: { id: string; ownerUserId: string | null; dueOn: string | null; doneAt: string | null }[],
  userId: string,
  todayYmd: string,
): { id: string }[] {
  return tasks.filter(
    (task) =>
      task.ownerUserId === userId &&
      !task.doneAt &&
      task.dueOn != null &&
      task.dueOn < todayYmd,
  );
}

export function calendarDayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}
