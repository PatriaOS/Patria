/** Pure helpers for the Home Today Sync card and This week list (D35). */
import { copy } from '../../lib/copy';
import type { SyncMeetingRow, SyncTaskRow } from './syncApi';
import { fillTemplate } from './syncLabels';
import { getZonedParts, syncCountdown } from './syncSchedule';

export const HOME_TASK_LIMIT = 4;

function civilDay(parts: { year: number; month: number; day: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/** Whole calendar days from `now` to `target` in `timeZone` (negative = past). */
function dayDiff(target: Date, now: Date, timeZone: string): number {
  return Math.round(
    (civilDay(getZonedParts(target, timeZone)) - civilDay(getZonedParts(now, timeZone))) /
      86_400_000,
  );
}

/**
 * "SUNDAY FAMILY SYNC · IN 4 DAYS". The weekday is the meeting's day in the family zone.
 * No countdown once the time has passed (no guilt); "HAPPENING NOW" while it runs.
 */
export function homeSyncOverline(
  meeting: { scheduledFor: Date; status: SyncMeetingRow['status'] | null },
  timeZone: string,
  now: Date = new Date(),
): string {
  const weekday = getZonedParts(meeting.scheduledFor, timeZone).weekday;
  const base = `${copy.sync.weekdaysLong[weekday]} ${copy.home.syncOverlineLabel}`.toUpperCase();
  let suffix: string | null = null;
  if (meeting.status === 'in_progress') {
    suffix = copy.home.syncHappeningNow.toUpperCase();
  } else if (meeting.scheduledFor.getTime() >= now.getTime()) {
    suffix = syncCountdown(meeting.scheduledFor, timeZone, now);
  }
  return suffix ? `${base} · ${suffix}` : base;
}

export function homeSyncMeetingTitle(circleName: string): string {
  return fillTemplate(copy.home.syncMeetingTitle, { circle: circleName });
}

/** "Done today" / "Done yesterday" in the family zone, otherwise null. */
export function taskDoneLabel(
  task: Pick<SyncTaskRow, 'doneAt'>,
  timeZone: string,
  now: Date = new Date(),
): string | null {
  if (!task.doneAt) {
    return null;
  }
  const diff = dayDiff(new Date(task.doneAt), now, timeZone);
  if (diff === 0) {
    return copy.home.taskDoneToday;
  }
  if (diff === -1) {
    return copy.home.taskDoneYesterday;
  }
  return null;
}

function compareDue(a: SyncTaskRow, b: SyncTaskRow): number {
  const byDue = (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99');
  return byDue !== 0 ? byDue : a.title.localeCompare(b.title);
}

/**
 * Up to `limit` tasks: open ones by due date first, then (if there is room) tasks the family
 * finished today or yesterday, so a task someone just ticked does not vanish from under them.
 */
export function selectThisWeekTasks(
  tasks: SyncTaskRow[],
  timeZone: string,
  now: Date = new Date(),
  limit: number = HOME_TASK_LIMIT,
): SyncTaskRow[] {
  const open = tasks.filter((task) => !task.doneAt).sort(compareDue).slice(0, limit);
  const room = limit - open.length;
  const recentlyDone =
    room > 0
      ? tasks
          .filter((task) => taskDoneLabel(task, timeZone, now) !== null)
          .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
          .slice(0, room)
      : [];
  return [...open, ...recentlyDone];
}

/** Day chip for a due date (`YYYY-MM-DD`): Today, Tomorrow, a weekday within the week, else "Oct 20". */
export function taskDueChip(
  dueOn: string | null,
  timeZone: string,
  now: Date = new Date(),
): string | null {
  if (!dueOn) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  if (!match) {
    return null;
  }
  const due = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const diff = Math.round((due - civilDay(getZonedParts(now, timeZone))) / 86_400_000);
  if (diff === 0) {
    return copy.home.taskChipToday;
  }
  if (diff === 1) {
    return copy.home.taskChipTomorrow;
  }
  const dueDate = new Date(due);
  if (diff >= 2 && diff <= 6) {
    return copy.sync.weekdaysShort[dueDate.getUTCDay()] ?? null;
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(dueDate);
}
