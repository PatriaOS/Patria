import {
  calendarDayInZone,
  overdueTasksForUser,
  rankHomeAttention,
  syncNeedsAttentionToday,
  visibleHomeAttention,
} from './homeAttention';

describe('homeAttention', () => {
  it('ranks recovery before device before sync before tasks', () => {
    const ranked = rankHomeAttention([
      { id: 't', kind: 'overdue_tasks' },
      { id: 'r', kind: 'recovery_setup' },
      { id: 's', kind: 'sync_due' },
      { id: 'd', kind: 'device_or_join' },
    ]);
    expect(ranked.map((row) => row.id)).toEqual(['r', 'd', 's', 't']);
  });

  it('shows at most two with a hidden count', () => {
    const ranked = rankHomeAttention([
      { id: 'a', kind: 'recovery_setup' },
      { id: 'b', kind: 'device_or_join' },
      { id: 'c', kind: 'sync_due' },
    ]);
    expect(visibleHomeAttention(ranked)).toEqual({
      shown: [ranked[0], ranked[1]],
      hiddenCount: 1,
    });
  });

  it('flags Sync in progress or due today', () => {
    const zone = 'America/Chicago';
    const now = new Date('2026-10-26T18:00:00Z');
    expect(
      syncNeedsAttentionToday(
        { status: 'in_progress', scheduledFor: '2026-10-26T00:00:00Z' },
        zone,
        now,
      ),
    ).toBe(true);
    expect(
      syncNeedsAttentionToday(
        { status: 'finished', scheduledFor: '2026-10-26T00:00:00Z' },
        zone,
        now,
      ),
    ).toBe(false);
  });

  it('finds overdue open tasks for the user', () => {
    const today = '2026-10-26';
    expect(
      overdueTasksForUser(
        [
          { id: '1', ownerUserId: 'u1', dueOn: '2026-10-20', doneAt: null },
          { id: '2', ownerUserId: 'u1', dueOn: '2026-10-26', doneAt: null },
          { id: '3', ownerUserId: 'u2', dueOn: '2026-10-01', doneAt: null },
          { id: '4', ownerUserId: 'u1', dueOn: '2026-10-01', doneAt: 'x' },
        ],
        'u1',
        today,
      ).map((row) => row.id),
    ).toEqual(['1']);
  });

  it('formats a calendar day in a zone', () => {
    expect(calendarDayInZone(new Date('2026-10-26T05:00:00Z'), 'UTC')).toBe('2026-10-26');
  });
});
