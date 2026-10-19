import { useQuery } from '@tanstack/react-query';

import { fetchFirstDeviceNotices } from '../../lib/crypto/deviceAccess';
import { supabaseRecoverFlowGateway } from '../../lib/crypto/recoverFlow';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { countHomeNotices } from './homeNotices';
import { useCurrentFamily } from './useCurrentFamily';

export function useHomeNoticeCount(): number {
  const { spaceId, userId, current, admin } = useCurrentFamily();

  const noticesQuery = useQuery({
    queryKey: ['deviceApprovalNotices', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFirstDeviceNotices(spaceId as string),
  });
  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, current?.role),
  });
  const recoveryRequestsQuery = useQuery({
    queryKey: ['recoveryRequests', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => supabaseRecoverFlowGateway.listRequests(spaceId as string),
  });
  const removedNoticesQuery = useQuery({
    queryKey: ['deviceRemovedNotices', spaceId],
    enabled: Boolean(spaceId && admin),
    queryFn: () => supabaseRecoverFlowGateway.listRemovedNotices(spaceId as string),
  });

  return countHomeNotices({
    deviceNotices: noticesQuery.data ?? [],
    recoveryStatus: recoveryQuery.data?.status,
    recoveryPendingInvites: recoveryQuery.data?.pending.length ?? 0,
    recoveryRequests: recoveryRequestsQuery.data ?? [],
    removedNoticeCount: removedNoticesQuery.data?.length ?? 0,
    userId,
  });
}
