import { syncOccurrenceCases } from './fixtures/syncOccurrenceCases';
import {
  formatMeetingWhen,
  nextMeetingAt,
  syncCountdown,
  type SyncFrequency,
  type SyncMonthlyMode,
  zonedTimeToUtc,
} from './syncSchedule';

describe('nextMeetingAt', () => {
  it('picks today when the weekday matches and local time has not passed', () => {
    // Wednesday 2026-10-21 14:00 Chicago
    const now = zonedTimeToUtc('America/Chicago', 2026, 10, 21, 14, 0);
    const next = nextMeetingAt(
      { weekday: 3, localTime: '18:30', timezone: 'America/Chicago' },
      now,
    );
    expect(next.toISOString()).toBe(
      zonedTimeToUtc('America/Chicago', 2026, 10, 21, 18, 30).toISOString(),
    );
  });

  it('rolls to next week when today local time has passed', () => {
    const now = zonedTimeToUtc('America/Chicago', 2026, 10, 21, 19, 0);
    const next = nextMeetingAt(
      { weekday: 3, localTime: '18:30', timezone: 'America/Chicago' },
      now,
    );
    expect(next.toISOString()).toBe(
      zonedTimeToUtc('America/Chicago', 2026, 10, 28, 18, 30).toISOString(),
    );
  });

  it('handles US spring-forward (CST to CDT)', () => {
    // 2026-03-08 02:00 local does not exist; Sunday meeting at 01:30 before jump.
    const now = zonedTimeToUtc('America/Chicago', 2026, 3, 7, 12, 0);
    const next = nextMeetingAt(
      { weekday: 0, localTime: '01:30', timezone: 'America/Chicago' },
      now,
    );
    expect(getChicagoParts(next)).toMatchObject({
      year: 2026,
      month: 3,
      day: 8,
      hour: 1,
      minute: 30,
    });
  });

  it('handles US fall-back (CDT to CST)', () => {
    const now = zonedTimeToUtc('America/Chicago', 2026, 10, 31, 12, 0);
    const next = nextMeetingAt(
      { weekday: 0, localTime: '01:30', timezone: 'America/Chicago' },
      now,
    );
    expect(getChicagoParts(next)).toMatchObject({
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
    });
  });
});

describe('syncCountdown', () => {
  const zone = 'America/Chicago';

  it('returns TONIGHT when the meeting is today and starts at or after 5 pm', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 25, 18, 30);
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 10, 0);
    expect(syncCountdown(meeting, zone, now)).toBe('TONIGHT');
  });

  it('returns TODAY when the meeting is today and starts before 5 pm', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 25, 14, 0);
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 9, 0);
    expect(syncCountdown(meeting, zone, now)).toBe('TODAY');
  });

  it('returns TOMORROW for the next calendar day in the family zone', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 26, 18, 30);
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 20, 0);
    expect(syncCountdown(meeting, zone, now)).toBe('TOMORROW');
  });

  it('returns IN N DAYS otherwise', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 29, 18, 30);
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 12, 0);
    expect(syncCountdown(meeting, zone, now)).toBe('IN 4 DAYS');
  });

  it('uses the family zone across a UTC day boundary', () => {
    // 2026-10-26 00:30 UTC = 2026-10-25 19:30 Chicago → still "today" / TONIGHT in Chicago
    const meeting = new Date('2026-10-26T00:30:00.000Z');
    const now = new Date('2026-10-26T02:00:00.000Z'); // 21:00 Chicago on the 25th
    expect(syncCountdown(meeting, zone, now)).toBe('TONIGHT');
  });
});

describe('formatMeetingWhen', () => {
  it('formats weekday and time in the family zone', () => {
    const meeting = zonedTimeToUtc('America/Chicago', 2026, 10, 25, 18, 30);
    const label = formatMeetingWhen(meeting, 'America/Chicago');
    expect(label).toMatch(/Sun/i);
    expect(label).toMatch(/6:30/);
  });
});

describe('nextMeetingAt frequency fixtures (D37)', () => {
  it.each(syncOccurrenceCases)('$id matches shared fixture', (fixture) => {
    const next = nextMeetingAt(
      {
        weekday: fixture.weekday,
        localTime: fixture.localTime,
        timezone: fixture.timezone,
        frequency: fixture.frequency as SyncFrequency,
        monthlyMode: (fixture.monthlyMode ?? null) as SyncMonthlyMode | null,
        monthlyOrdinal: fixture.monthlyOrdinal ?? null,
        monthDay: fixture.monthDay ?? null,
        anchorLocalDate: fixture.anchorLocalDate ?? null,
      },
      new Date(fixture.after),
    );
    expect(next.toISOString()).toBe(fixture.expected);
  });
});

function getChicagoParts(date: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
  };
}
