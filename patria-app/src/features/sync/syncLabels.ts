import { copy } from '../../lib/copy';
import type { CircleOption } from '../../lib/family';
import type { SyncAgendaItemRow, SyncMeetingRow, SyncTaskRow } from './syncApi';
import { agendaAddedByLabel, syncPersonLabel } from './syncAuthor';
import type { SyncAgendaKind, SyncStep } from './syncSchedule';

export type PersonLookup = {
  members: { userId: string; displayName: string }[];
  children: { id: string; displayName: string }[];
};

/** Sync only offers these two circles (D35). */
export const SYNC_CIRCLE_KINDS = ['household', 'extended_family'] as const;

export function circleDisplayName(circle: Pick<CircleOption, 'kind' | 'name'> | undefined): string {
  if (!circle) {
    return copy.circles.household;
  }
  const known = copy.circles[circle.kind as keyof typeof copy.circles];
  return known ?? circle.name;
}

export function kindLabel(kind: SyncAgendaKind): string {
  return copy.sync.kinds[kind];
}

export function stepTitle(step: SyncStep): string {
  return copy.sync.steps[step].title;
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

export function agendaRowBody(item: SyncAgendaItemRow, people: PersonLookup): string {
  const details = item.details.trim();
  if (details.length > 0) {
    return details;
  }
  return fillTemplate(copy.sync.addedBy, {
    name: agendaAddedByLabel({
      authorUserId: item.authorUserId,
      attributedChildId: item.attributedChildId,
      members: people.members,
      children: people.children,
    }),
  });
}

/** First name unless another peer shares it — then the full display name. */
export function shortDisplayName(fullName: string, peerNames: readonly string[]): string {
  const trimmed = fullName.trim();
  const first = trimmed.split(/\s+/).filter(Boolean)[0] ?? trimmed;
  if (!first) {
    return trimmed;
  }
  const firstLower = first.toLowerCase();
  const clashes = peerNames.filter((name) => {
    const peerFirst = name.trim().split(/\s+/).filter(Boolean)[0] ?? '';
    return peerFirst.toLowerCase() === firstLower;
  }).length;
  return clashes > 1 ? trimmed : first;
}

export function taskPersonLabel(
  userId: string | null,
  childId: string | null,
  people: PersonLookup,
): string | null {
  if (childId) {
    // Child profiles keep the name as stored (usually already a first name).
    return people.children.find((row) => row.id === childId)?.displayName ?? copy.sync.formerMember;
  }
  if (userId) {
    const full = syncPersonLabel(userId, people.members);
    if (!full || full === copy.sync.formerMember) {
      return full;
    }
    return shortDisplayName(
      full,
      people.members.map((member) => member.displayName),
    );
  }
  return null;
}

/** "Owner Elena · Backup Marco" (no due date). */
export function taskPeopleLine(task: SyncTaskRow, people: PersonLookup): string {
  const owner = taskPersonLabel(task.ownerUserId, task.ownerChildId, people);
  const backup = taskPersonLabel(task.backupUserId, task.backupChildId, people);
  return [
    owner ? fillTemplate(copy.sync.ownerIs, { name: owner }) : '',
    backup ? fillTemplate(copy.sync.backupIs, { name: backup }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function taskBodyLine(task: SyncTaskRow, people: PersonLookup): string {
  return [
    taskPeopleLine(task, people),
    task.dueOn ? fillTemplate(copy.sync.dueOn, { date: task.dueOn }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Whether `userId` may toggle a task (mirrors RLS: admin, owner or backup). */
export function canToggleTask(task: SyncTaskRow, userId: string | undefined, admin: boolean): boolean {
  return admin || (Boolean(userId) && (task.ownerUserId === userId || task.backupUserId === userId));
}

export function canEditAgendaItem(
  item: Pick<SyncAgendaItemRow, 'authorUserId'>,
  userId: string | undefined,
  admin: boolean,
): boolean {
  return admin || (Boolean(userId) && item.authorUserId === userId);
}

export type MeetingSummary = {
  total: number;
  discussed: number;
  decisions: { title: string; decision: string }[];
};

export function buildMeetingSummary(items: SyncAgendaItemRow[]): MeetingSummary {
  return {
    total: items.length,
    discussed: items.filter((item) => item.discussedAt).length,
    decisions: items
      .filter((item) => item.kind === 'decide' && item.decisionText.trim().length > 0)
      .map((item) => ({ title: item.title, decision: item.decisionText.trim() })),
  };
}

export function readMeetingSummary(summary: Record<string, unknown>): MeetingSummary {
  const total = typeof summary.total === 'number' ? summary.total : 0;
  const discussed = typeof summary.discussed === 'number' ? summary.discussed : 0;
  const rawDecisions = Array.isArray(summary.decisions) ? summary.decisions : [];
  const decisions = rawDecisions.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return typeof record.title === 'string' && typeof record.decision === 'string'
      ? [{ title: record.title, decision: record.decision }]
      : [];
  });
  return { total, discussed, decisions };
}

export function summaryLine(summary: MeetingSummary): string {
  return fillTemplate(copy.sync.summaryLine, {
    discussed: String(summary.discussed),
    total: String(summary.total),
  });
}

export function formatMeetingDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

export function isMissed(meeting: Pick<SyncMeetingRow, 'status' | 'scheduledFor'>, now: Date): boolean {
  return meeting.status === 'upcoming' && new Date(meeting.scheduledFor).getTime() < now.getTime();
}

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalTime(value: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Normalizes `9:05` to `09:05` for the database. */
export function normalizeLocalTime(value: string): string {
  const [hour, minute] = value.trim().split(':');
  return `${(hour ?? '0').padStart(2, '0')}:${minute ?? '00'}`;
}
