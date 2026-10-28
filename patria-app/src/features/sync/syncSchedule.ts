/** Next Sync occurrence and countdown labels in the family IANA time zone (D35 / D37). */

export type SyncFrequency = 'weekly' | 'every_two_weeks' | 'monthly';
export type SyncMonthlyMode = 'same_weekday' | 'same_date';

export type SyncScheduleInput = {
  weekday: number;
  /** `HH:MM` or `HH:MM:SS` local wall time. */
  localTime: string;
  timezone: string;
  frequency?: SyncFrequency;
  monthlyMode?: SyncMonthlyMode | null;
  monthlyOrdinal?: number | null;
  monthDay?: number | null;
  /** Civil date (YYYY-MM-DD) anchoring every-two-weeks series. */
  anchorLocalDate?: string | null;
};

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export function parseLocalTime(localTime: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(localTime.trim());
  if (!match) {
    throw new Error('Invalid local time');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error('Invalid local time');
  }
  return { hour, minute, second };
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  const weekday = WEEKDAY_SHORT[bag.weekday ?? ''];
  if (weekday === undefined) {
    throw new Error('Invalid weekday');
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday,
  };
}

/** Instant whose wall clock in `timeZone` is the given civil time. */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += wanted - asUtc;
  }
  return new Date(utc);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): { year: number; month: number; day: number } | null {
  if (ordinal === -1) {
    const last = lastDayOfMonth(year, month);
    const lastParts = { year, month, day: last };
    const lastDate = new Date(Date.UTC(year, month - 1, last));
    const lastWd = lastDate.getUTCDay();
    const delta = (lastWd - weekday + 7) % 7;
    return addCalendarDays(lastParts.year, lastParts.month, lastParts.day, -delta);
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWd = first.getUTCDay();
  const delta = (weekday - firstWd + 7) % 7;
  const day = 1 + delta + (ordinal - 1) * 7;
  if (day > lastDayOfMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function nextWeekdayOccurrence(
  schedule: SyncScheduleInput,
  nowUtc: Date,
): Date {
  const { hour, minute, second } = parseLocalTime(schedule.localTime);
  const now = getZonedParts(nowUtc, schedule.timezone);
  const delta = (schedule.weekday - now.weekday + 7) % 7;
  const candidateDay = addCalendarDays(now.year, now.month, now.day, delta);
  let candidate = zonedTimeToUtc(
    schedule.timezone,
    candidateDay.year,
    candidateDay.month,
    candidateDay.day,
    hour,
    minute,
    second,
  );
  if (candidate.getTime() <= nowUtc.getTime()) {
    const nextWeek = addCalendarDays(candidateDay.year, candidateDay.month, candidateDay.day, 7);
    candidate = zonedTimeToUtc(
      schedule.timezone,
      nextWeek.year,
      nextWeek.month,
      nextWeek.day,
      hour,
      minute,
      second,
    );
  }
  return candidate;
}

/**
 * Preview next Sync start in the family time zone (D37).
 * SQL `next_sync_occurrence` is authoritative on save; this mirrors it for the schedule form.
 */
export function nextMeetingAt(schedule: SyncScheduleInput, nowUtc: Date = new Date()): Date {
  const frequency = schedule.frequency ?? 'weekly';
  const { hour, minute, second } = parseLocalTime(schedule.localTime);

  if (frequency === 'weekly') {
    return nextWeekdayOccurrence(schedule, nowUtc);
  }

  if (frequency === 'every_two_weeks') {
    if (!schedule.anchorLocalDate) {
      return nextWeekdayOccurrence(schedule, nowUtc);
    }
    const [y, m, d] = schedule.anchorLocalDate.split('-').map(Number);
    let day = { year: y, month: m, day: d };
    const anchorWd = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (anchorWd !== schedule.weekday) {
      day = addCalendarDays(day.year, day.month, day.day, (schedule.weekday - anchorWd + 7) % 7);
    }
    let candidate = zonedTimeToUtc(
      schedule.timezone,
      day.year,
      day.month,
      day.day,
      hour,
      minute,
      second,
    );
    while (candidate.getTime() <= nowUtc.getTime()) {
      day = addCalendarDays(day.year, day.month, day.day, 14);
      candidate = zonedTimeToUtc(
        schedule.timezone,
        day.year,
        day.month,
        day.day,
        hour,
        minute,
        second,
      );
    }
    return candidate;
  }

  // monthly
  const now = getZonedParts(nowUtc, schedule.timezone);
  for (let i = 0; i < 36; i += 1) {
    const monthIndex = now.month - 1 + i;
    const year = now.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    let day: { year: number; month: number; day: number } | null;
    if (schedule.monthlyMode === 'same_date') {
      const monthDay = schedule.monthDay ?? 1;
      day = {
        year,
        month,
        day: Math.min(monthDay, lastDayOfMonth(year, month)),
      };
    } else {
      day = nthWeekdayOfMonth(year, month, schedule.weekday, schedule.monthlyOrdinal ?? 1);
      if (!day) {
        continue;
      }
    }
    const candidate = zonedTimeToUtc(
      schedule.timezone,
      day.year,
      day.month,
      day.day,
      hour,
      minute,
      second,
    );
    if (candidate.getTime() > nowUtc.getTime()) {
      return candidate;
    }
  }
  throw new Error('No next monthly occurrence');
}

export type SyncCountdown = 'TONIGHT' | 'TODAY' | 'TOMORROW' | `IN ${number} DAYS`;

/**
 * Countdown for Home / Sync overline, in the family time zone.
 * TONIGHT if the meeting is today and starts at or after 17:00; TODAY if today and earlier;
 * TOMORROW for tomorrow; otherwise IN N DAYS.
 */
export function syncCountdown(
  scheduledFor: Date,
  timeZone: string,
  nowUtc: Date = new Date(),
): SyncCountdown {
  const meeting = getZonedParts(scheduledFor, timeZone);
  const now = getZonedParts(nowUtc, timeZone);
  const meetingDay = Date.UTC(meeting.year, meeting.month - 1, meeting.day);
  const nowDay = Date.UTC(now.year, now.month - 1, now.day);
  const dayDiff = Math.round((meetingDay - nowDay) / 86_400_000);
  if (dayDiff <= 0) {
    if (meeting.hour >= 17) {
      return 'TONIGHT';
    }
    return 'TODAY';
  }
  if (dayDiff === 1) {
    return 'TOMORROW';
  }
  return `IN ${dayDiff} DAYS`;
}

/** Flow card title using the same countdown words as the hub hero. */
export function syncFlowTitle(
  scheduledFor: Date,
  timeZone: string,
  nowUtc: Date = new Date(),
): string {
  const countdown = syncCountdown(scheduledFor, timeZone, nowUtc);
  if (countdown === 'TONIGHT') {
    return 'Tonight’s flow';
  }
  if (countdown === 'TODAY') {
    return 'Today’s flow';
  }
  if (countdown === 'TOMORROW') {
    return 'Tomorrow’s flow';
  }
  const weekday = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
  }).format(scheduledFor);
  return `${weekday}’s flow`;
}

export function formatMeetingWhen(scheduledFor: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(scheduledFor);
}

export const SYNC_STEPS = ['wins', 'look_ahead', 'decide', 'gratitude'] as const;
export type SyncStep = (typeof SYNC_STEPS)[number];

export const SYNC_AGENDA_KINDS = ['win', 'discuss', 'decide', 'plan'] as const;
export type SyncAgendaKind = (typeof SYNC_AGENDA_KINDS)[number];

export function kindsForStep(step: SyncStep): SyncAgendaKind[] {
  if (step === 'wins') {
    return ['win'];
  }
  if (step === 'look_ahead') {
    return ['discuss', 'plan'];
  }
  if (step === 'decide') {
    return ['decide'];
  }
  return [];
}
