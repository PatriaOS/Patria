import type { SyncTaskRow } from './syncApi';
import {
  homeSyncMeetingTitle,
  homeSyncOverline,
  selectThisWeekTasks,
  taskDoneLabel,
  taskDueChip,
} from './syncHome';
import { nextMeetingAt, zonedTimeToUtc } from './syncSchedule';

const zone = 'America/Chicago';

function task(id: string, overrides: Partial<SyncTaskRow> = {}): SyncTaskRow {
  return {
    id,
    familySpaceId: 's1',
    meetingId: 'm1',
    title: `Task ${id}`,
    ownerUserId: null,
    ownerChildId: null,
    backupUserId: null,
    backupChildId: null,
    dueOn: null,
    doneAt: null,
    doneBy: null,
    ...overrides,
  };
}

describe('homeSyncOverline', () => {
  it('pairs the circle day with the countdown (IN 4 DAYS)', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 29, 18, 30); // Thursday
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 12, 0);
    expect(homeSyncOverline({ scheduledFor: meeting, status: 'upcoming' }, zone, now)).toBe(
      'THURSDAY FAMILY SYNC · IN 4 DAYS',
    );
  });

  it('says TONIGHT, TODAY and TOMORROW in the family zone', () => {
    const now = zonedTimeToUtc(zone, 2026, 10, 25, 9, 0); // Sunday
    expect(
      homeSyncOverline(
        { scheduledFor: zonedTimeToUtc(zone, 2026, 10, 25, 19, 0), status: 'upcoming' },
        zone,
        now,
      ),
    ).toBe('SUNDAY FAMILY SYNC · TONIGHT');
    expect(
      homeSyncOverline(
        { scheduledFor: zonedTimeToUtc(zone, 2026, 10, 25, 14, 0), status: 'upcoming' },
        zone,
        now,
      ),
    ).toBe('SUNDAY FAMILY SYNC · TODAY');
    expect(
      homeSyncOverline(
        { scheduledFor: zonedTimeToUtc(zone, 2026, 10, 26, 19, 0), status: 'upcoming' },
        zone,
        now,
      ),
    ).toBe('MONDAY FAMILY SYNC · TOMORROW');
  });

  it('drops the countdown after the time has passed and says happening now while it runs', () => {
    const meeting = zonedTimeToUtc(zone, 2026, 10, 25, 19, 0);
    const later = zonedTimeToUtc(zone, 2026, 10, 25, 21, 0);
    expect(homeSyncOverline({ scheduledFor: meeting, status: 'upcoming' }, zone, later)).toBe(
      'SUNDAY FAMILY SYNC',
    );
    expect(homeSyncOverline({ scheduledFor: meeting, status: 'in_progress' }, zone, later)).toBe(
      'SUNDAY FAMILY SYNC · HAPPENING NOW',
    );
  });

  it('Sunday meeting via nextMeetingAt: TONIGHT before start, IN 7 DAYS after it ends', () => {
    const schedule = { weekday: 0, localTime: '19:00', timezone: zone };
    const before = zonedTimeToUtc(zone, 2026, 10, 25, 9, 0);
    const nextBefore = nextMeetingAt(schedule, before);
    expect(
      homeSyncOverline({ scheduledFor: nextBefore, status: 'upcoming' }, zone, before),
    ).toBe('SUNDAY FAMILY SYNC · TONIGHT');

    const after = zonedTimeToUtc(zone, 2026, 10, 25, 21, 0);
    const nextAfter = nextMeetingAt(schedule, after);
    expect(
      homeSyncOverline({ scheduledFor: nextAfter, status: 'upcoming' }, zone, after),
    ).toBe('SUNDAY FAMILY SYNC · IN 7 DAYS');
  });
});

describe('homeSyncMeetingTitle', () => {
  it('names the meeting after its circle', () => {
    expect(homeSyncMeetingTitle('Household')).toBe('Household meeting');
  });
});

describe('selectThisWeekTasks', () => {
  const now = zonedTimeToUtc(zone, 2026, 10, 25, 12, 0);

  it('returns up to four open tasks, soonest due first, undated last', () => {
    const tasks = [
      task('none'),
      task('late', { dueOn: '2026-10-30' }),
      task('soon', { dueOn: '2026-10-26' }),
      task('mid', { dueOn: '2026-10-28' }),
      task('later', { dueOn: '2026-11-02' }),
    ];
    expect(selectThisWeekTasks(tasks, zone, now).map((t) => t.id)).toEqual([
      'soon',
      'mid',
      'late',
      'later',
    ]);
  });

  it('fills spare room with tasks done today or yesterday, never older', () => {
    const tasks = [
      task('open', { dueOn: '2026-10-27' }),
      task('today', { doneAt: zonedTimeToUtc(zone, 2026, 10, 25, 9, 0).toISOString() }),
      task('yesterday', { doneAt: zonedTimeToUtc(zone, 2026, 10, 24, 20, 0).toISOString() }),
      task('old', { doneAt: zonedTimeToUtc(zone, 2026, 10, 20, 9, 0).toISOString() }),
    ];
    expect(selectThisWeekTasks(tasks, zone, now).map((t) => t.id)).toEqual([
      'open',
      'today',
      'yesterday',
    ]);
  });

  it('gives open tasks priority over done ones when there are four open', () => {
    const tasks = [
      task('a', { dueOn: '2026-10-26' }),
      task('b', { dueOn: '2026-10-27' }),
      task('c', { dueOn: '2026-10-28' }),
      task('d', { dueOn: '2026-10-29' }),
      task('done', { doneAt: now.toISOString() }),
    ];
    expect(selectThisWeekTasks(tasks, zone, now).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('taskDoneLabel', () => {
  it('uses the family zone for today and yesterday', () => {
    // 2026-10-26 03:00 UTC is still Sunday evening in Chicago.
    const now = new Date('2026-10-26T03:00:00.000Z');
    expect(taskDoneLabel({ doneAt: '2026-10-26T01:00:00.000Z' }, zone, now)).toBe('Done today');
    expect(taskDoneLabel({ doneAt: '2026-10-25T01:00:00.000Z' }, zone, now)).toBe(
      'Done yesterday',
    );
    expect(taskDoneLabel({ doneAt: '2026-10-20T01:00:00.000Z' }, zone, now)).toBeNull();
    expect(taskDoneLabel({ doneAt: null }, zone, now)).toBeNull();
  });
});

describe('taskDueChip', () => {
  const now = zonedTimeToUtc(zone, 2026, 10, 25, 12, 0); // Sunday

  it('says Today and Tomorrow, then the weekday within the week', () => {
    expect(taskDueChip('2026-10-25', zone, now)).toBe('Today');
    expect(taskDueChip('2026-10-26', zone, now)).toBe('Tomorrow');
    expect(taskDueChip('2026-10-29', zone, now)).toBe('Thu');
  });

  it('uses a plain date for later or earlier days and nothing without a due date', () => {
    expect(taskDueChip('2026-11-12', zone, now)).toMatch(/Nov/);
    expect(taskDueChip('2026-10-20', zone, now)).toMatch(/Oct/);
    expect(taskDueChip(null, zone, now)).toBeNull();
  });
});
