import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { formatLetterDate } from '../letters/letterDates';
import {
  calendarDayInZone,
  overdueTasksForUser,
  rankHomeAttention,
  syncNeedsAttentionToday,
  type HomeAttentionKind,
} from './homeAttention';

export type NeedsYouItem = {
  id: string;
  kind: HomeAttentionKind;
  rank: number;
  title: string;
  body: string;
  actionLabel: string;
  href: string;
  testID: string;
};

/** The few letter fields Needs you reads. Letters the person can't see never reach this list. */
export type NeedsYouLetter = {
  id: string;
  authorId: string;
  recipientId: string;
  status: string;
  visibility: string;
  recipientLeftAt: string | null;
  triggerAt: string | null;
  authorName: string | null;
  recipientName: string | null;
};

export type NeedsYouInput = {
  keyHolder: boolean;
  recoveryAccepted: number;
  hasPaper: boolean;
  recoveryStatus: string | undefined;
  syncMeeting: { status: string; scheduledFor: string } | null | undefined;
  /** True when the person can see the upcoming Sync and has not answered yet. */
  syncRsvpNeeded?: boolean;
  timeZone: string;
  userId: string | undefined;
  tasks: { id: string; ownerUserId: string | null; dueOn: string | null; doneAt: string | null }[];
  /** Device / join / recovery-invite rows that need this user's tap. */
  deviceOrJoinCount: number;
  /** Letters visible to this person (see useLetterAttention). */
  letters?: NeedsYouLetter[];
  now?: Date;
};

function letterNeedsYouItem(
  letter: NeedsYouLetter,
  userId: string | undefined,
  timeZone: string,
): Omit<NeedsYouItem, 'rank'> | null {
  if (!userId) {
    return null;
  }
  const action = copy.letters.needsYouOpenLetters;
  // The author can still withdraw a sealed letter whose recipient left.
  if (
    letter.authorId === userId &&
    letter.recipientLeftAt != null &&
    (letter.status === 'sealed' || letter.status === 'pending')
  ) {
    return {
      id: `letter-left-${letter.id}`,
      kind: 'letter_recipient_left',
      title: copy.letters.needsYouRecipientLeftTitle,
      body: copy.letters.needsYouRecipientLeftBody.replace(
        '{name}',
        letter.recipientName ?? copy.letters.formerMember,
      ),
      actionLabel: action,
      href: routes.letters,
      testID: 'needs-you-letter-left',
    };
  }
  if (letter.recipientId !== userId || letter.recipientLeftAt != null) {
    return null;
  }
  const from = letter.authorName ?? copy.letters.formerMember;
  if (letter.status === 'pending') {
    return {
      id: `letter-pending-${letter.id}`,
      kind: 'letter_pending',
      title: copy.letters.needsYouPendingTitle,
      body: copy.letters.needsYouPendingBody.replace('{name}', from),
      actionLabel: action,
      href: routes.letters,
      testID: 'needs-you-letter-pending',
    };
  }
  if (letter.status === 'sealed' && letter.visibility === 'announced') {
    return {
      id: `letter-announced-${letter.id}`,
      kind: 'letter_announced',
      title: copy.letters.needsYouAnnouncedTitle,
      body: copy.letters.needsYouAnnouncedBody
        .replace('{name}', from)
        .replace(
          '{date}',
          letter.triggerAt ? formatLetterDate(letter.triggerAt, timeZone) : '',
        ),
      actionLabel: action,
      href: routes.letters,
      testID: 'needs-you-letter-announced',
    };
  }
  return null;
}

/** Ranked Needs you rows for the bell badge and Needs you screen. Navigation only. */
export function buildNeedsYouItems(input: NeedsYouInput): NeedsYouItem[] {
  const now = input.now ?? new Date();
  const today = calendarDayInZone(now, input.timeZone);
  const raw: Omit<NeedsYouItem, 'rank'>[] = [];

  if (input.keyHolder && input.recoveryAccepted < 2) {
    raw.push({
      id: 'recovery-setup',
      kind: 'recovery_setup',
      title: copy.home.recoveryCardTitle,
      body: copy.home.recoveryCardBody,
      actionLabel: copy.home.needsYouOpenRecovery,
      href: routes.privacySecurity,
      testID: 'needs-you-recovery-setup',
    });
  } else if (input.keyHolder && input.recoveryAccepted >= 2 && !input.hasPaper) {
    raw.push({
      id: 'recovery-paper',
      kind: 'recovery_setup',
      title: copy.home.recoveryPrintedAction,
      body: copy.home.needsYouPrintedBody,
      actionLabel: copy.home.needsYouOpenRecovery,
      href: routes.privacySecurity,
      testID: 'needs-you-recovery-paper',
    });
  }

  if (input.deviceOrJoinCount > 0) {
    raw.push({
      id: 'device-or-join',
      kind: 'device_or_join',
      title: copy.home.needsYouDeviceTitle,
      body: copy.home.needsYouDeviceBody.replace(
        '{count}',
        String(input.deviceOrJoinCount),
      ),
      actionLabel: copy.home.needsYouOpenFamily,
      href: routes.family,
      testID: 'needs-you-device',
    });
  }

  if (syncNeedsAttentionToday(input.syncMeeting, input.timeZone, now)) {
    raw.push({
      id: 'sync-due',
      kind: 'sync_due',
      title: copy.home.syncAttentionTitle,
      body: copy.home.syncAttentionBody,
      actionLabel: copy.home.syncAttentionAction,
      href: routes.sync,
      testID: 'needs-you-sync',
    });
  }

  if (
    input.userId &&
    overdueTasksForUser(input.tasks, input.userId, today).length > 0
  ) {
    raw.push({
      id: 'overdue-tasks',
      kind: 'overdue_tasks',
      title: copy.home.overdueAttentionTitle,
      body: copy.home.overdueAttentionBody,
      actionLabel: copy.home.overdueAttentionAction,
      href: routes.syncTasks,
      testID: 'needs-you-overdue',
    });
  }

  if (input.syncRsvpNeeded) {
    raw.push({
      id: 'sync-rsvp',
      kind: 'sync_rsvp',
      title: copy.home.needsYouSyncRsvpTitle,
      body: copy.home.needsYouSyncRsvpBody,
      actionLabel: copy.home.needsYouOpenSync,
      href: routes.sync,
      testID: 'needs-you-sync-rsvp',
    });
  }

  for (const letter of input.letters ?? []) {
    const item = letterNeedsYouItem(letter, input.userId, input.timeZone);
    if (item) {
      raw.push(item);
    }
  }

  const ranked = rankHomeAttention(raw.map(({ id, kind }) => ({ id, kind })));
  return ranked
    .map((row) => {
      const item = raw.find((entry) => entry.id === row.id);
      return item ? { ...item, rank: row.rank } : null;
    })
    .filter((item): item is NeedsYouItem => item != null);
}

export function needsYouBadgeCount(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count > 9 ? '9+' : String(count);
}

export function needsYouBellLabel(count: number): string {
  return copy.home.needsYouBellLabel.replace('{count}', String(count));
}
