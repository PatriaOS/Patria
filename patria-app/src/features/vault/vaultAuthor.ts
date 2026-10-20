import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';

export function vaultAuthorLabel(
  authorId: string,
  members: { userId: string; displayName: string }[],
): string {
  const member = members.find((row) => row.userId === authorId);
  return member ? memberDisplayName(member.displayName) : copy.vault.formerMember;
}

export function formatVaultDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
