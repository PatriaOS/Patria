import { buildSyncCalendarEvent, SYNC_CALENDAR_EVENT_TITLE, SYNC_CALENDAR_LINK } from './syncCalendar';

describe('buildSyncCalendarEvent', () => {
  it('builds a 30-minute Family Sync event with the deep link only', () => {
    const start = new Date('2026-11-02T00:00:00.000Z');
    const draft = buildSyncCalendarEvent(start);
    expect(draft.title).toBe(SYNC_CALENDAR_EVENT_TITLE);
    expect(draft.startDate.toISOString()).toBe(start.toISOString());
    expect(draft.endDate.toISOString()).toBe(new Date(start.getTime() + 30 * 60 * 1000).toISOString());
    expect(draft.notes).toBe(SYNC_CALENDAR_LINK);
    expect(draft.url).toBe(SYNC_CALENDAR_LINK);
    expect(JSON.stringify(draft)).not.toMatch(/agenda|Elena|Household/i);
  });
});
