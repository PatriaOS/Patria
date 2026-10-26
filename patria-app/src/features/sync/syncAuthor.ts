import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';

export function syncPersonLabel(
  userId: string | null | undefined,
  members: { userId: string; displayName: string }[],
): string {
  if (!userId) {
    return copy.sync.formerMember;
  }
  const member = members.find((row) => row.userId === userId);
  return member ? memberDisplayName(member.displayName) : copy.sync.formerMember;
}

export function agendaAddedByLabel(input: {
  authorUserId: string;
  attributedChildId: string | null;
  members: { userId: string; displayName: string }[];
  children: { id: string; displayName: string }[];
}): string {
  if (input.attributedChildId) {
    const child = input.children.find((row) => row.id === input.attributedChildId);
    return child?.displayName ?? copy.sync.formerMember;
  }
  return syncPersonLabel(input.authorUserId, input.members);
}
