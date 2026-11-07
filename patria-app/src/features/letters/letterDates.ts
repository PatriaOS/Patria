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

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Calendar day of someone's Nth birthday from a DOB (YYYY-MM-DD).
 * Feb 29 → Mar 1 in non-leap years (D43 / Slice B1).
 */
export function birthdayYmdAtAge(dobYmd: string, age: number): string {
  const parsed = parseYmd(dobYmd);
  if (!parsed || !Number.isInteger(age) || age < 1 || age > 120) {
    throw new Error('invalid birthday age');
  }
  const y = parsed.y + age;
  if (parsed.m === 2 && parsed.d === 29 && !isLeapYear(y)) {
    return `${String(y).padStart(4, '0')}-03-01`;
  }
  return `${String(y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

/** English ordinal for age copy ("18th", "1st", "22nd"). */
export function ageOrdinal(age: number): string {
  const n = Math.trunc(age);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Author-facing age open line: "Test 2's 18th birthday" (never a calendar date). */
export function formatAgeOpenLabel(name: string, age: number): string {
  return `${name}'s ${ageOrdinal(age)} birthday`;
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

/**
 * Friendly open day in the device locale (US: "Friday, November 5, 2027").
 * `ymd` is the calendar day in the family zone; formatting uses that zone's midnight.
 */
export function formatLetterOpenDay(ymd: string, timeZone: string): string {
  if (!isValidYmd(ymd)) {
    return ymd;
  }
  const iso = zonedMidnightIso(ymd, timeZone);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * DateTimePicker shows the device-local calendar of a Date. Build noon local so
 * the spinner matches `ymd` on any device; save with zonedMidnightIso(family TZ).
 */
export function ymdToPickerDate(ymd: string): Date {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    return new Date();
  }
  return new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0);
}

/** Read the device-local calendar day the DateTimePicker is showing. */
export function pickerDateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** True when the day is today or earlier on the device calendar (birthday wheel). */
export function isOnOrBeforeTodayLocal(ymd: string, now = new Date()): boolean {
  return isValidYmd(ymd) && ymd <= pickerDateToYmd(now);
}

/** Friendly birthday label from YYYY-MM-DD (device locale; no time zone math). */
export function formatBirthdayYmd(ymd: string): string {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0));
}

const US_ZONE_STEM =
  /^(Eastern|Central|Pacific|Mountain|Alaska|Hawaii|Hawaii-Aleutian|Atlantic)$/i;

/** Prefer a full friendly label ("Central Time"), never a bare "Central". */
function withTimeWord(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/\bTime$/i.test(trimmed)) {
    return trimmed.replace(/\s+(Standard|Daylight|Summer)\s+Time$/i, ' Time');
  }
  if (US_ZONE_STEM.test(trimmed)) {
    return `${trimmed} Time`;
  }
  return trimmed;
}

/**
 * Friendly zone label for people ("Central Time"). Keep the IANA name for
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
      return withTimeWord(name);
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
      return withTimeWord(name);
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
