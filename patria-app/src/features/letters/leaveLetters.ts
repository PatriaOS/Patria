import type { LetterRow } from './letterApi';

export type LeaveLetters = {
  /** Sealed letters the person can keep (default) or withdraw. */
  sealed: LetterRow[];
  /** Drafts that never got sealed. They go quietly with the person. */
  draftIds: string[];
};

/** Letters this person wrote that need a decision before they leave the family. */
export function lettersToDecideOnLeave(rows: LetterRow[], userId: string): LeaveLetters {
  const mine = rows.filter((row) => row.authorId === userId);
  return {
    sealed: mine.filter((row) => row.status === 'sealed'),
    draftIds: mine.filter((row) => row.status === 'draft').map((row) => row.id),
  };
}

/** Ids to hand to leave_family_with_letters. Default is keep, so only chosen letters go. */
export function withdrawIdsForLeave(letters: LeaveLetters, withdrawChosen: ReadonlySet<string>): string[] {
  const sealedIds = new Set(letters.sealed.map((row) => row.id));
  const chosen = [...withdrawChosen].filter((id) => sealedIds.has(id));
  return [...chosen, ...letters.draftIds];
}

export function hasLettersToDecide(letters: LeaveLetters): boolean {
  return letters.sealed.length > 0 || letters.draftIds.length > 0;
}
