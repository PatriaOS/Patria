import { shortDisplayName, taskPeopleLine, type PersonLookup } from './syncLabels';
import type { SyncTaskRow } from './syncApi';

const people: PersonLookup = {
  members: [
    { userId: 'u1', displayName: 'Elena Rivera' },
    { userId: 'u2', displayName: 'Marco Rivera' },
    { userId: 'u3', displayName: 'Elena Costa' },
  ],
  children: [{ id: 'c1', displayName: 'Sofia' }],
};

function task(partial: Partial<SyncTaskRow>): SyncTaskRow {
  return {
    id: 't1',
    familySpaceId: 's1',
    meetingId: 'm1',
    title: 'Task',
    ownerUserId: null,
    ownerChildId: null,
    backupUserId: null,
    backupChildId: null,
    dueOn: null,
    doneAt: null,
    doneBy: null,
    ...partial,
  };
}

describe('shortDisplayName', () => {
  it('uses the first name when it is unique among peers', () => {
    expect(shortDisplayName('Elena Rivera', ['Elena Rivera', 'Marco Rivera'])).toBe('Elena');
  });

  it('keeps the full name when two peers share a first name', () => {
    expect(
      shortDisplayName('Elena Rivera', ['Elena Rivera', 'Elena Costa', 'Marco Rivera']),
    ).toBe('Elena Rivera');
  });
});

describe('taskPeopleLine', () => {
  it('shows first names for members and the child name as stored', () => {
    const twoAdults = { members: people.members.slice(0, 2), children: people.children };
    expect(
      taskPeopleLine(task({ ownerUserId: 'u1', backupUserId: 'u2' }), twoAdults),
    ).toBe('Owner Elena · Backup Marco');
    expect(taskPeopleLine(task({ ownerChildId: 'c1', backupUserId: 'u1' }), twoAdults)).toBe(
      'Owner Sofia · Backup Elena',
    );
  });

  it('uses full names when two Elenas share a family', () => {
    expect(taskPeopleLine(task({ ownerUserId: 'u1', backupUserId: 'u3' }), people)).toBe(
      'Owner Elena Rivera · Backup Elena Costa',
    );
  });
});
