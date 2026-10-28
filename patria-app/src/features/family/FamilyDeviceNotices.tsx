import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ButtonStack, Card, ErrorState, Muted, Title } from '../../ui';
import { copy } from '../../lib/copy';
import {
  approveFirstDevice,
  approveOwnExtraDevice,
  declineFirstDevice,
  fetchFirstDeviceNotices,
  rejectOwnExtraDevice,
  type FirstDeviceNotice,
} from '../../lib/crypto/deviceAccess';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import {
  approveRecoveryAsContact,
  cancelledCopyKind,
  cancelRecoveryRequest,
  requestCanFinish,
  supabaseRecoverFlowGateway,
  type RecoveryRequestRow,
} from '../../lib/crypto/recoverFlow';
import {
  loadRecoverySnapshot,
  respondRecoveryInvite,
} from '../../lib/crypto/recoverySetup';
import { fetchMembers } from '../../lib/family';
import { memberDisplayName } from '../../lib/displayName';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { ApproveMyDeviceCard, formatDeviceWhen } from '../keys/ApproveMyDeviceScreen';
import { useCurrentFamily } from './useCurrentFamily';

/** Let in / Decline and related device notices. Lives on Family (not Home). */
export function FamilyDeviceNotices() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, spaceId, current, admin } = useCurrentFamily();
  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });
  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, current?.role],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () =>
      ensureKeysForOpenFamily({
        spaceId: spaceId as string,
        userId: userId as string,
        role: current?.role,
      }),
  });
  const noticesQuery = useQuery({
    queryKey: ['deviceApprovalNotices', spaceId],
    enabled: Boolean(spaceId),
    refetchOnMount: 'always',
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

  const onLetIn = async (notice: FirstDeviceNotice) => {
    if (!userId || !spaceId) {
      return;
    }
    setNoticeError(null);
    setBusyNoticeId(notice.id);
    try {
      const device = await ensureDeviceIdentity(userId);
      const member = (membersQuery.data ?? []).find((row) => row.userId === notice.userId);
      await approveFirstDevice({
        spaceId,
        adminUserId: userId,
        adminDeviceId: device.deviceId,
        adminPrivateKey: device.privateKey,
        notice,
        memberRole: member?.role,
      });
      await queryClient.invalidateQueries({ queryKey: ['deviceApprovalNotices', spaceId] });
      await queryClient.invalidateQueries({ queryKey: ['familyKeyStatus'] });
    } catch (error) {
      const info = describeCaughtError(error);
      logFailedAction(error);
      logKeyStep('let_in_failed', `${info.code} ${info.message}`);
      setNoticeError(copy.home.letInFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onDecline = async (noticeId: string) => {
    setNoticeError(null);
    setBusyNoticeId(noticeId);
    try {
      await declineFirstDevice(noticeId);
      await queryClient.invalidateQueries({ queryKey: ['deviceApprovalNotices', spaceId] });
    } catch (error) {
      logFailedAction(error);
      setNoticeError(copy.home.declineFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onApproveMyPhone = async (notice: FirstDeviceNotice) => {
    if (!userId || !spaceId || !current) {
      return;
    }
    setNoticeError(null);
    setBusyNoticeId(notice.id);
    try {
      const device = await ensureDeviceIdentity(userId);
      await approveOwnExtraDevice({
        spaceId,
        userId,
        approverDeviceId: device.deviceId,
        approverPrivateKey: device.privateKey,
        notice,
        role: current.role,
      });
      await queryClient.invalidateQueries({ queryKey: ['deviceApprovalNotices', spaceId] });
      await queryClient.invalidateQueries({ queryKey: ['familyKeyStatus'] });
    } catch (error) {
      const info = describeCaughtError(error);
      logFailedAction(error);
      logKeyStep('approve_own_phone_failed', `${info.code} ${info.message}`);
      setNoticeError(copy.home.approvePhoneFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onRejectMyPhone = async (notice: FirstDeviceNotice) => {
    if (!userId || !spaceId) {
      return;
    }
    setNoticeError(null);
    setBusyNoticeId(notice.id);
    try {
      await rejectOwnExtraDevice({ spaceId, userId, notice });
      await queryClient.invalidateQueries({ queryKey: ['deviceApprovalNotices', spaceId] });
    } catch (error) {
      logFailedAction(error);
      setNoticeError(copy.home.rejectPhoneFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onCancelRecovery = async (requestId: string) => {
    setNoticeError(null);
    setBusyNoticeId(requestId);
    try {
      await cancelRecoveryRequest(requestId);
      await queryClient.invalidateQueries({ queryKey: ['recoveryRequests', spaceId] });
    } catch (caught) {
      logFailedAction(caught);
      setNoticeError(copy.home.recoveryCancelFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onApproveRecoveryHelp = async (request: RecoveryRequestRow) => {
    if (!userId || !spaceId) {
      return;
    }
    const slot = recoveryQuery.data?.contacts.find(
      (row) => row.userId === userId && row.status === 'accepted',
    )?.slot;
    if (!slot) {
      return;
    }
    setNoticeError(null);
    setBusyNoticeId(request.id);
    try {
      const device = await ensureDeviceIdentity(userId);
      await approveRecoveryAsContact({
        spaceId,
        request,
        slot,
        contactUserId: userId,
        contactDeviceId: device.deviceId,
        contactPrivateKey: device.privateKey,
      });
      await queryClient.invalidateQueries({ queryKey: ['recoveryRequests', spaceId] });
    } catch (caught) {
      logFailedAction(caught);
      setNoticeError(copy.home.recoveryApproveFailed);
    } finally {
      setBusyNoticeId(null);
    }
  };

  const onRecoveryRespond = async (accept: boolean) => {
    if (!spaceId || !userId) {
      return;
    }
    try {
      await respondRecoveryInvite({ spaceId, userId, accept });
      await queryClient.invalidateQueries({ queryKey: ['recoverySnapshot', spaceId, userId] });
    } catch (caught) {
      logFailedAction(caught);
      setNoticeError(copy.common.error);
    }
  };

  if (!current) {
    return null;
  }

  return (
    <>
      {noticeError ? <ErrorState message={noticeError} /> : null}
      {(recoveryQuery.data?.pending ?? [])
        .filter((row) => row.userId === userId)
        .map((row) => (
          <Card key={`invite-${row.id}`}>
            <Title>{copy.home.recoveryInviteTitle}</Title>
            <Muted>{copy.home.recoveryInviteBody}</Muted>
            <ButtonStack>
              <Button label={copy.home.recoveryAccept} onPress={() => void onRecoveryRespond(true)} />
              <Button
                label={copy.home.recoveryDecline}
                variant="secondary"
                onPress={() => void onRecoveryRespond(false)}
              />
            </ButtonStack>
          </Card>
        ))}
      {keyStatusQuery.data && keyStatusQuery.data !== 'ready' ? (
        <Button
          label={copy.home.lostPhone}
          testID="i-lost-my-phone"
          variant="secondary"
          onPress={() => router.push(routes.recoverLostPhone)}
        />
      ) : null}
      {(recoveryRequestsQuery.data ?? []).map((request) => {
        const member = (membersQuery.data ?? []).find((row) => row.userId === request.userId);
        const name = memberDisplayName(member?.displayName);
        const when = formatDeviceWhen(request.newDeviceCreatedAt ?? request.startedAt);
        const open = request.cancelledAt == null && request.completedAt == null;
        const own = request.userId === userId;
        if (own && request.cancelledAt) {
          return (
            <Card key={request.id}>
              <Title>
                {cancelledCopyKind(request.cancelledBy, userId) === 'you'
                  ? copy.home.recoveryCancelledByYou
                  : copy.home.recoveryCancelledByAdmin}
              </Title>
            </Card>
          );
        }
        if (own && open) {
          return (
            <Card key={request.id}>
              <Title>{copy.home.recoveryWaiting}</Title>
              <Muted>{when}</Muted>
              <ButtonStack>
                <Button
                  label={copy.home.notMyPhone}
                  variant="secondary"
                  busy={busyNoticeId === request.id}
                  disabled={busyNoticeId !== null && busyNoticeId !== request.id}
                  onPress={() => void onCancelRecovery(request.id)}
                />
                <Button
                  label={copy.recovery.lostTitle}
                  variant="secondary"
                  onPress={() => router.push(routes.recoverLostPhone)}
                />
              </ButtonStack>
            </Card>
          );
        }
        if (open && !own) {
          const myContact = recoveryQuery.data?.contacts.find(
            (row) => row.userId === userId && row.status === 'accepted',
          );
          if (!admin && !myContact) {
            return null;
          }
          return (
            <Card key={request.id}>
              <Title>
                {admin
                  ? copy.home.recoveryAdminNotice.replace('{name}', name)
                  : copy.home.recoveryContactNotice.replace('{name}', name)}
              </Title>
              {myContact ? (
                <Muted>{copy.home.recoveryContactNotice.replace('{name}', name)}</Muted>
              ) : null}
              <Muted>{when}</Muted>
              <ButtonStack>
                {myContact && requestCanFinish(request) ? (
                  <Button
                    label={copy.home.recoveryApproveHelp}
                    busy={busyNoticeId === request.id}
                    disabled={busyNoticeId !== null && busyNoticeId !== request.id}
                    onPress={() => void onApproveRecoveryHelp(request)}
                  />
                ) : null}
                {admin ? (
                  <Button
                    label={copy.home.stopThisRecovery}
                    variant="secondary"
                    busy={busyNoticeId === request.id}
                    disabled={busyNoticeId !== null && busyNoticeId !== request.id}
                    onPress={() => void onCancelRecovery(request.id)}
                  />
                ) : null}
              </ButtonStack>
            </Card>
          );
        }
        return null;
      })}
      {(removedNoticesQuery.data ?? []).map((notice) => {
        const member = (membersQuery.data ?? []).find((row) => row.userId === notice.userId);
        const name = memberDisplayName(member?.displayName);
        return (
          <Card key={notice.id}>
            <Title>{copy.home.deviceRemovedNotice.replace('{name}', name)}</Title>
          </Card>
        );
      })}
      {(noticesQuery.data ?? []).map((notice) => {
        const member = (membersQuery.data ?? []).find((row) => row.userId === notice.userId);
        const name = memberDisplayName(member?.displayName);
        const own = notice.userId === userId;
        const whenLabel = formatDeviceWhen(notice.deviceCreatedAt);
        const setUp = copy.home.deviceSetUp.replace('{when}', whenLabel);

        if (notice.kind === 'extra_device') {
          if (own && keyStatusQuery.data === 'ready') {
            return (
              <ApproveMyDeviceCard
                key={notice.id}
                notice={notice}
                name={name}
                canApprove
                busy={busyNoticeId === notice.id}
                disabled={busyNoticeId !== null && busyNoticeId !== notice.id}
                onApprove={() => void onApproveMyPhone(notice)}
                onReject={() => void onRejectMyPhone(notice)}
              />
            );
          }
          if (admin && !own) {
            return (
              <ApproveMyDeviceCard
                key={notice.id}
                notice={notice}
                name={name}
                canApprove={false}
                busy={false}
                disabled
                onApprove={() => undefined}
                onReject={() => undefined}
              />
            );
          }
          return null;
        }

        if (notice.kind === 'rejected_device') {
          if (!admin) {
            return null;
          }
          return (
            <Card key={notice.id}>
              <Title>{copy.home.extraDeviceRejectedNotice.replace('{name}', name)}</Title>
              <Muted>{setUp}</Muted>
            </Card>
          );
        }

        if (!admin || own) {
          return null;
        }
        const title = copy.home.extraDeviceAdminNotice.replace('{name}', name);
        return (
          <Card key={notice.id} testID="family-let-in-card">
            <Title testID="let-in-notice">{title}</Title>
            <Muted>
              {member ? copy.roles[member.role] : ''}
              {member ? ' · ' : ''}
              {setUp}
            </Muted>
            <ButtonStack>
              <Button
                label={copy.home.letIn}
                busy={busyNoticeId === notice.id}
                disabled={busyNoticeId !== null && busyNoticeId !== notice.id}
                onPress={() => void onLetIn(notice)}
                accessibilityHint={title}
              />
              <Button
                label={copy.home.declineDevice}
                variant="secondary"
                busy={busyNoticeId === notice.id}
                disabled={busyNoticeId !== null && busyNoticeId !== notice.id}
                onPress={() => void onDecline(notice.id)}
              />
            </ButtonStack>
          </Card>
        );
      })}
    </>
  );
}
