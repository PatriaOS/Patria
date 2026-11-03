import { calendarDayInZone } from '../family/homeAttention';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const match = YMD.exec(value.trim());
  if (!match) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

export function isValidYmd(value: string): boolean {
  return parseYmd(value) != null;
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant (ISO, UTC) at which the given calendar day starts in the zone. */
export function zonedMidnightIso(ymd: string, timeZone: string): string {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    throw new Error('invalid date');
  }
  const guess = Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0);
  const first = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** True when the day is strictly after today in the family zone. */
export function isAfterToday(ymd: string, timeZone: string, now = new Date()): boolean {
  return isValidYmd(ymd) && ymd > calendarDayInZone(now, timeZone);
}

export function addYearsToYmd(ymd: string, years: number): string {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    throw new Error('invalid date');
  }
  const y = parsed.y + years;
  // Feb 29 lands on Feb 28 in a year with no leap day.
  const lastDay = new Date(Date.UTC(y, parsed.m, 0)).getUTCDate();
  const d = Math.min(parsed.d, lastDay);
  return `${String(y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function ymdInZone(iso: string, timeZone: string): string {
  return calendarDayInZone(new Date(iso), timeZone);
}

export function formatLetterDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Friendly open day, e.g. "Tuesday, 2 November 2027". */
export function formatLetterOpenDay(ymd: string, timeZone: string): string {
  if (!isValidYmd(ymd)) {
    return ymd;
  }
  const iso = zonedMidnightIso(ymd, timeZone);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Short friendly zone label for people ("Central Time"). Keep the IANA name for
 * accessibility hints only.
 */
export function friendlyTimeZoneName(timeZone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longGeneric',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value?.trim();
    if (name) {
      return name;
    }
  } catch {
    // Fall through.
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value?.trim();
    if (name) {
      return name.replace(/\s+(Standard|Daylight|Summer)\s+Time$/i, ' Time');
    }
  } catch {
    // Fall through.
  }
  return timeZone;
}

/** Tomorrow's calendar day in the family zone (YYYY-MM-DD). */
export function tomorrowYmd(timeZone: string, now = new Date()): string {
  const today = calendarDayInZone(now, timeZone);
  const parsed = parseYmd(today);
  if (!parsed) {
    return today;
  }
  const next = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + 1));
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** True once the trigger instant has passed. */
export function triggerHasPassed(triggerAtIso: string, now = new Date()): boolean {
  return new Date(triggerAtIso).getTime() <= now.getTime();
}
