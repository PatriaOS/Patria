import type { FirstDeviceNotice } from '../../lib/crypto/deviceAccess';
import type { RecoveryRequestRow } from '../../lib/crypto/recoverFlow';
import type { RecoveryHomeStatus } from '../../lib/crypto/recoverySetup';

export function countHomeNotices({
  deviceNotices,
  recoveryStatus,
  recoveryPendingInvites,
  recoveryRequests,
  removedNoticeCount,
  userId,
}: {
  deviceNotices: FirstDeviceNotice[];
  recoveryStatus?: RecoveryHomeStatus;
  recoveryPendingInvites: number;
  recoveryRequests: RecoveryRequestRow[];
  removedNoticeCount: number;
  userId?: string;
}): number {
  const openRecovery = recoveryRequests.filter((request) => {
    if (request.cancelledAt || request.completedAt) {
      return false;
    }
    return Boolean(userId);
  }).length;

  return (
    deviceNotices.length +
    (recoveryStatus === 'needs_attention' ? 1 : 0) +
    recoveryPendingInvites +
    openRecovery +
    removedNoticeCount
  );
}
