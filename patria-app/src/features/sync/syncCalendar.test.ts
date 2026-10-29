import { DayOfTheWeek, Frequency } from 'expo-calendar/legacy';

import {
  buildSyncCalendarEvent,
  recurrenceForSchedule,
  SYNC_CALENDAR_EVENT_TITLE,
  SYNC_CALENDAR_LINK,
} from './syncCalendar';

describe('buildSyncCalendarEvent', () => {
  it('builds a 30-minute Family Sync event with the deep link only', () => {
    const start = new Date('2026-11-02T00:00:00.000Z');
    const draft = buildSyncCalendarEvent(start, {
      frequency: 'weekly',
      weekday: 0,
      monthlyMode: null,
      monthlyOrdinal: null,
      monthDay: null,
    });
    expect(draft.title).toBe(SYNC_CALENDAR_EVENT_TITLE);
    expect(draft.startDate.toISOString()).toBe(start.toISOString());
    expect(draft.endDate.toISOString()).toBe(new Date(start.getTime() + 30 * 60 * 1000).toISOString());
    expect(draft.notes).toBe(SYNC_CALENDAR_LINK);
    expect(draft.url).toBe(SYNC_CALENDAR_LINK);
    expect(draft.recurrenceRule).toEqual({ frequency: Frequency.WEEKLY, interval: 1 });
    expect(JSON.stringify(draft)).not.toMatch(/agenda|Elena|Household/i);
  });
});

describe('recurrenceForSchedule', () => {
  it('maps every two weeks to weekly interval 2', () => {
    expect(
      recurrenceForSchedule({
        frequency: 'every_two_weeks',
        weekday: 0,
        monthlyMode: null,
        monthlyOrdinal: null,
        monthDay: null,
      }),
    ).toEqual({ frequency: Frequency.WEEKLY, interval: 2 });
  });

  it('maps monthly same date to daysOfTheMonth', () => {
    expect(
      recurrenceForSchedule({
        frequency: 'monthly',
        weekday: 0,
        monthlyMode: 'same_date',
        monthlyOrdinal: null,
        monthDay: 15,
      }),
    ).toEqual({ frequency: Frequency.MONTHLY, interval: 1, daysOfTheMonth: [15] });
  });

  it('maps monthly same weekday with EventKit Sunday = 1', () => {
    expect(
      recurrenceForSchedule({
        frequency: 'monthly',
        weekday: 0,
        monthlyMode: 'same_weekday',
        monthlyOrdinal: -1,
        monthDay: null,
      }),
    ).toEqual({
      frequency: Frequency.MONTHLY,
      interval: 1,
      daysOfTheWeek: [{ dayOfTheWeek: DayOfTheWeek.Sunday, weekNumber: -1 }],
    });
  });
});
