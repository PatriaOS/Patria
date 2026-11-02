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

  it('lists an unanswered Sync invite after overdue tasks', () => {
    const items = buildNeedsYouItems({
      keyHolder: false,
      recoveryAccepted: 2,
      hasPaper: true,
      recoveryStatus: 'ready',
      syncMeeting: { status: 'upcoming', scheduledFor: '2026-11-02T00:00:00Z' },
      syncRsvpNeeded: true,
      timeZone: 'UTC',
      userId: 'u1',
      tasks: [],
      deviceOrJoinCount: 0,
      now: new Date('2026-10-26T12:00:00Z'),
    });
    expect(items.map((row) => row.id)).toEqual(['sync-rsvp']);
    expect(items[0]?.testID).toBe('needs-you-sync-rsvp');
  });

  it('hides the Sync invite after the person answers', () => {
    const items = buildNeedsYouItems({
      keyHolder: false,
      recoveryAccepted: 2,
      hasPaper: true,
      recoveryStatus: 'ready',
      syncMeeting: { status: 'upcoming', scheduledFor: '2026-11-02T00:00:00Z' },
      syncRsvpNeeded: false,
      timeZone: 'UTC',
      userId: 'u1',
      tasks: [],
      deviceOrJoinCount: 0,
      now: new Date('2026-10-26T12:00:00Z'),
    });
    expect(items.map((row) => row.id)).toEqual([]);
  });

  describe('letters', () => {
    const base = {
      keyHolder: false,
      recoveryAccepted: 2,
      hasPaper: true,
      recoveryStatus: 'ready',
      syncMeeting: null,
      timeZone: 'UTC',
      userId: 'me',
      tasks: [],
      deviceOrJoinCount: 0,
      now: new Date('2026-10-26T12:00:00Z'),
    };
    const letter = {
      id: 'l1',
      authorId: 'ana',
      recipientId: 'me',
      status: 'pending',
      visibility: 'surprise',
      recipientLeftAt: null,
      triggerAt: '2026-10-20T00:00:00Z',
      authorName: 'Ana',
      recipientName: 'Me',
    };

    it('tells the recipient a letter is waiting', () => {
      const items = buildNeedsYouItems({ ...base, letters: [letter] });
      expect(items.map((row) => row.kind)).toEqual(['letter_pending']);
      expect(items[0]?.body).toBe(copy.letters.needsYouPendingBody.replace('{name}', 'Ana'));
    });

    it('tells the recipient about an announced letter that has not opened yet', () => {
      const items = buildNeedsYouItems({
        ...base,
        letters: [
          { ...letter, status: 'sealed', visibility: 'announced', triggerAt: '2027-01-05T12:00:00Z' },
        ],
      });
      expect(items.map((row) => row.kind)).toEqual(['letter_announced']);
      expect(items[0]?.body).toContain('Ana');
    });

    it('stays quiet about a sealed surprise', () => {
      const items = buildNeedsYouItems({
        ...base,
        letters: [{ ...letter, status: 'sealed', visibility: 'surprise' }],
      });
      expect(items).toEqual([]);
    });

    it('tells the author when the recipient left', () => {
      const items = buildNeedsYouItems({
        ...base,
        userId: 'ana',
        letters: [
          {
            ...letter,
            status: 'sealed',
            recipientId: 'ben',
            recipientLeftAt: '2026-10-25T00:00:00Z',
            recipientName: null,
          },
        ],
      });
      expect(items.map((row) => row.kind)).toEqual(['letter_recipient_left']);
      expect(items[0]?.body).toContain(copy.letters.formerMember);
    });

    it('does not list a pending letter for someone who has left', () => {
      const items = buildNeedsYouItems({
        ...base,
        letters: [{ ...letter, recipientLeftAt: '2026-10-25T00:00:00Z' }],
      });
      expect(items).toEqual([]);
    });

    it('ranks letters after the older kinds', () => {
      const items = buildNeedsYouItems({
        ...base,
        deviceOrJoinCount: 1,
        letters: [letter],
      });
      expect(items.map((row) => row.kind)).toEqual(['device_or_join', 'letter_pending']);
    });
  });

  it('formats the bell badge and label', () => {
    expect(needsYouBadgeCount(0)).toBeNull();
    expect(needsYouBadgeCount(3)).toBe('3');
    expect(needsYouBadgeCount(10)).toBe('9+');
    expect(needsYouBellLabel(2)).toBe(copy.home.needsYouBellLabel.replace('{count}', '2'));
  });
});
