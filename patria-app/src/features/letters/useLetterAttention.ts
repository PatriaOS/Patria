import { useQuery } from '@tanstack/react-query';

import { memberDisplayName } from '../../lib/displayName';
import { fetchMembers } from '../../lib/family';
import type { NeedsYouLetter } from '../family/needsYou';
import { fetchLetterKeepersForAuthor, fetchLetters, type LetterRow } from './letterApi';

export function letterQueryKey(spaceId: string | null | undefined, userId: string | undefined) {
  return ['letters', spaceId, userId] as const;
}

export function toNeedsYouLetters(
  rows: LetterRow[],
  members: { userId: string; displayName: string }[],
  keeperReplaceIds: Set<string> = new Set(),
): NeedsYouLetter[] {
  const nameOf = (id: string): string | null => {
    const member = members.find((row) => row.userId === id);
    return member ? memberDisplayName(member.displayName) : null;
  };
  return rows.map((row) => ({
    id: row.id,
    authorId: row.authorId,
    recipientId: row.recipientId,
    status: row.status,
    visibility: row.visibility,
    recipientLeftAt: row.recipientLeftAt,
    triggerAt: row.triggerAt,
    authorName: nameOf(row.authorId),
    recipientName: nameOf(row.recipientId),
    keeperReplaceNeeded: keeperReplaceIds.has(row.id),
  }));
}

/**
 * Letters that may need this person's attention. Row Level Security already hides
 * every letter they may not know about (a surprise stays hidden until it is opening).
 * A failed load is quiet: Home and Needs you simply show nothing extra.
 */
export function useLetterAttention(
  spaceId: string | null | undefined,
  userId: string | undefined,
): NeedsYouLetter[] {
  const query = useQuery({
    queryKey: [...letterQueryKey(spaceId, userId), 'attention'],
    enabled: Boolean(spaceId && userId),
    retry: false,
    queryFn: async () => {
      const [rows, members] = await Promise.all([
        fetchLetters(spaceId as string),
        fetchMembers(spaceId as string),
      ]);
      const authoredSealed = rows.filter(
        (row) =>
          row.authorId === userId &&
          (row.status === 'sealed' || row.status === 'pending'),
      );
      const keeperReplaceIds = new Set<string>();
      await Promise.all(
        authoredSealed.map(async (row) => {
          try {
            const keepers = await fetchLetterKeepersForAuthor(row.id);
            if (keepers.some((k) => !k.stillMember)) {
              keeperReplaceIds.add(row.id);
            }
          } catch {
            // Quiet: Needs you simply omits the row.
          }
        }),
      );
      return toNeedsYouLetters(rows, members, keeperReplaceIds);
    },
  });
  return query.data ?? [];
}
