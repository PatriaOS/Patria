import { copy } from '../../lib/copy';
import { buildNeedsYouItems, needsYouBadgeCount, needsYouBellLabel } from './needsYou';

describe('needsYou', () => {
  it('ranks recovery before device before sync before tasks', () => {
    const items = buildNeedsYouItems({
      keyHolder: true,
      recoveryAccepted: 0,
      hasPaper: false,
      recoveryStatus: 'not_setup',
      syncMeeting: { status: 'in_progress', scheduledFor: '2026-10-26T00:00:00Z' },
      timeZone: 'UTC',
      userId: 'u1',
      tasks: [{ id: 't1', ownerUserId: 'u1', dueOn: '2026-10-01', doneAt: null }],
      deviceOrJoinCount: 1,
      now: new Date('2026-10-26T12:00:00Z'),
    });
    expect(items.map((row) => row.id)).toEqual([
      'recovery-setup',
      'device-or-join',
      'sync-due',
      'overdue-tasks',
    ]);
  });

  it('formats the bell badge and label', () => {
    expect(needsYouBadgeCount(0)).toBeNull();
    expect(needsYouBadgeCount(3)).toBe('3');
    expect(needsYouBadgeCount(10)).toBe('9+');
    expect(needsYouBellLabel(2)).toBe(copy.home.needsYouBellLabel.replace('{count}', '2'));
  });
});
