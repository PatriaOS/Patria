import type { FirstDeviceNotice } from '../../lib/crypto/deviceAccess';
import type { RecoveryRequestRow } from '../../lib/crypto/recoverFlow';

type RecoverySnapshotLike = {
  pending: { userId: string }[];
  contacts: { userId: string; status: string }[];
};

/** How many device / join / recovery-invite items need this user's attention. */
export function countDeviceOrJoinAttention(input: {
  userId: string | undefined;
  admin: boolean;
  keyStatus: string | undefined;
  notices: FirstDeviceNotice[];
  recoveryRequests: RecoveryRequestRow[];
  recovery: RecoverySnapshotLike | undefined;
  removedNoticeCount: number;
}): number {
  if (!input.userId) {
    return 0;
  }
  let count = 0;

  count += input.recovery?.pending.filter((row) => row.userId === input.userId).length ?? 0;

  if (input.keyStatus && input.keyStatus !== 'ready') {
    count += 1;
  }

  for (const request of input.recoveryRequests) {
    const open = request.cancelledAt == null && request.completedAt == null;
    const own = request.userId === input.userId;
    if (own && request.cancelledAt) {
      count += 1;
      continue;
    }
    if (own && open) {
      count += 1;
      continue;
    }
    if (open && !own) {
      const myContact = input.recovery?.contacts.find(
        (row) => row.userId === input.userId && row.status === 'accepted',
      );
      if (input.admin || myContact) {
        count += 1;
      }
    }
  }

  count += input.removedNoticeCount;

  for (const notice of input.notices) {
    const own = notice.userId === input.userId;
    if (notice.kind === 'extra_device') {
      if ((own && input.keyStatus === 'ready') || (input.admin && !own)) {
        count += 1;
      }
      continue;
    }
    if (notice.kind === 'rejected_device') {
      if (input.admin) {
        count += 1;
      }
      continue;
    }
    if (input.admin && !own) {
      count += 1;
    }
  }

  return count;
}
