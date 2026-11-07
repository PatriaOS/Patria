import type { LetterRow } from './letterApi';
import { hasLettersToDecide, lettersToDecideOnLeave, withdrawIdsForLeave } from './leaveLetters';

function letter(id: string, patch: Partial<LetterRow>): LetterRow {
  return {
    id,
    familySpaceId: 's1',
    authorId: 'me',
    recipientId: 'r1',
    fromLabel: 'Mum',
    visibility: 'surprise',
    triggerKind: 'date',
    triggerAge: null,
    triggerAt: '2035-01-01T00:00:00.000Z',
    status: 'sealed',
    version: 1,
    contentHash: null,
    fingerprint: null,
    voiceObjectPath: null,
    recipientLeftAt: null,
    sealedAt: null,
    pendingAt: null,
    releasedAt: null,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('leaveLetters', () => {
  const rows = [
    letter('a', {}),
    letter('b', {}),
    letter('c', { status: 'pending' }),
    letter('d', { status: 'draft' }),
    letter('e', { authorId: 'someone-else' }),
  ];

  it('asks only about my sealed letters and sweeps my drafts', () => {
    const decide = lettersToDecideOnLeave(rows, 'me');
    expect(decide.sealed.map((row) => row.id)).toEqual(['a', 'b']);
    expect(decide.draftIds).toEqual(['d']);
    expect(hasLettersToDecide(decide)).toBe(true);
    expect(hasLettersToDecide(lettersToDecideOnLeave(rows, 'nobody'))).toBe(false);
  });

  it('keeps every letter by default', () => {
    const decide = lettersToDecideOnLeave(rows, 'me');
    expect(withdrawIdsForLeave(decide, new Set())).toEqual(['d']);
  });

  it('withdraws only the letters chosen, and ignores ids that are not mine to withdraw', () => {
    const decide = lettersToDecideOnLeave(rows, 'me');
    expect(withdrawIdsForLeave(decide, new Set(['b', 'c', 'e']))).toEqual(['b', 'd']);
  });
});
