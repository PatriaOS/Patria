import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import {
  AvatarStack,
  Body,
  Button,
  Card,
  Display,
  DisplayItalic,
  ErrorState,
  LoadingState,
  Muted,
  Overline,
  Screen,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { fetchMembers } from '../../lib/family';
import { signOutAndGoWelcome } from '../../lib/authSession';
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
  homeRotationQueryKey,
  homeRotationUiFromOutcome,
  rotateFamilyKeyIfNeeded,
  type HomeRotationUi,
  type RotationOutcome,
} from '../../lib/crypto/rotateFamilyKey';
import {
  approveRecoveryAsContact,
  cancelledCopyKind,
  cancelRecoveryRequest,
  requestCanFinish,
  supabaseRecoverFlowGateway,
  type RecoveryRequestRow,
} from '../../lib/crypto/recoverFlow';
import {
  fulfillAcceptedContacts,
  loadRecoverySnapshot,
  respondRecoveryInvite,
} from '../../lib/crypto/recoverySetup';
import { ApproveMyDeviceCard, formatDeviceWhen } from '../keys/ApproveMyDeviceScreen';
import { memberDisplayName } from '../../lib/displayName';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { homeDateOverline, homeFamilyLine, homeGreeting } from './homeGreeting';
import { HomeToday } from './HomeToday';
import { SecurityStatusCard } from './SecurityStatusCard';
import { useCurrentFamily } from './useCurrentFamily';

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { userId, spaceId, membershipsQuery, current, admin, keyHolder } = useCurrentFamily();
  const [signingOut, setSigningOut] = useState(false);
  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [rotationUi, setRotationUi] = useState<HomeRotationUi>('hidden');
  const [rotationAttempt, setRotationAttempt] = useState(0);

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
    queryFn: () =>
      loadRecoverySnapshot(spaceId as string, userId as string, current?.role),
  });
  const recoveryRequestsQuery = useQuery({
    queryKey: ['recoveryRequests', spaceId],
    enabled: Boolean(spaceId),
    refetchOnMount: 'always',
    queryFn: () => supabaseRecoverFlowGateway.listRequests(spaceId as string),
  });
  const removedNoticesQuery = useQuery({
    queryKey: ['deviceRemovedNotices', spaceId],
    enabled: Boolean(spaceId && admin),
    refetchOnMount: 'always',
    queryFn: () => supabaseRecoverFlowGateway.listRemovedNotices(spaceId as string),
  });
  const onRefresh = useCallback(() => {
    if (userId) {
      void queryClient.invalidateQueries({ queryKey: ['memberships', userId] });
      void queryClient.invalidateQueries({ queryKey: ['memberships-gate', userId] });
    }
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['members', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['children', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['invites', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['familyKeyStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['deviceApprovalNotices', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['recoverySnapshot', spaceId, userId] });
      void queryClient.invalidateQueries({ queryKey: ['recoveryRequests', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['deviceRemovedNotices', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['memories', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncSchedule', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncMeetings', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncAgenda'] });
      void queryClient.invalidateQueries({ queryKey: ['syncTasks', spaceId] });
    }
  }, [queryClient, userId, spaceId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        onRefresh();
      }
    });
    return () => sub.remove();
  }, [onRefresh]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      onRefresh();
    });
    return unsubscribe;
  }, [navigation, onRefresh]);

  const cachedRotationQuery = useQuery({
    queryKey: homeRotationQueryKey(spaceId ?? ''),
    queryFn: async (): Promise<HomeRotationUi> => 'hidden',
    enabled: Boolean(spaceId),
    staleTime: Infinity,
  });
  const shownRotation =
    cachedRotationQuery.data === 'updating' ||
    cachedRotationQuery.data === 'upToDate' ||
    cachedRotationQuery.data === 'failed'
      ? cachedRotationQuery.data
      : rotationUi;

  useEffect(() => {
    if (!admin || !spaceId || !userId || keyStatusQuery.data !== 'ready') {
      return;
    }
    void rotateFamilyKeyIfNeeded(
      {
        spaceId,
        userId,
        role: current?.role,
      },
      undefined,
      () => {
        setRotationUi('updating');
        queryClient.setQueryData(homeRotationQueryKey(spaceId), 'updating');
      },
    ).then((outcome: RotationOutcome) => {
      if (outcome === 'rotated' || outcome === 'alreadyCurrent') {
        setRotationUi('upToDate');
        queryClient.setQueryData(homeRotationQueryKey(spaceId), 'upToDate');
        return;
      }
      if (outcome === 'failed') {
        setRotationUi('failed');
        queryClient.setQueryData(homeRotationQueryKey(spaceId), 'failed');
        return;
      }
      setRotationUi((prev) => {
        if (prev === 'updating' || prev === 'upToDate' || prev === 'failed') {
          return prev;
        }
        return homeRotationUiFromOutcome(outcome);
      });
    });
  }, [
    admin,
    spaceId,
    userId,
    keyStatusQuery.data,
    current?.role,
    rotationAttempt,
    queryClient,
  ]);

  const refreshing =
    membershipsQuery.isRefetching ||
    membersQuery.isRefetching ||
    noticesQuery.isRefetching ||
    recoveryQuery.isRefetching ||
    recoveryRequestsQuery.isRefetching ||
    removedNoticesQuery.isRefetching;

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutAndGoWelcome({
        signOut: () => supabase.auth.signOut(),
        replace: (href) => router.replace(href),
      });
    } finally {
      setSigningOut(false);
    }
  };

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

  useEffect(() => {
    if (!keyHolder || !spaceId || !userId || keyStatusQuery.data !== 'ready') {
      return;
    }
    if ((recoveryQuery.data?.accepted ?? 0) === 0) {
      return;
    }
    void fulfillAcceptedContacts({
      spaceId,
      memberUserId: userId,
    }).catch((caught: unknown) => {
      logFailedAction(caught);
    });
  }, [keyHolder, spaceId, userId, keyStatusQuery.data, recoveryQuery.data?.accepted]);

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

  const joinFamilyLink = (
    <Pressable
      testID={testIdFromLabel(copy.home.joinFamily)}
      accessibilityRole="link"
      accessibilityLabel={copy.home.joinFamily}
      onPress={() => router.push(routes.joinFamily)}
      style={styles.joinLink}
    >
      <Muted tone="primary">{copy.home.joinFamily}</Muted>
    </Pressable>
  );
  if (membershipsQuery.isLoading) {
    return (
      <Screen withTabBar>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (membershipsQuery.error) {
    return (
      <Screen withTabBar>
        <ErrorState message={copy.common.error} />
        <Button
          label={copy.home.rotationRetry}
          variant="secondary"
          onPress={() => {
            void membershipsQuery.refetch();
            onRefresh();
          }}
        />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen
        withTabBar
        accessibilityLabel={copy.home.noFamilyTitle}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <Title>{copy.home.noFamilyTitle}</Title>
        <Body>{copy.home.noFamilyBody}</Body>
        <Button label={copy.createFamily.submit} onPress={() => router.push(routes.createFamily)} />
        {joinFamilyLink}
      </Screen>
    );
  }

  if (membersQuery.error) {
    return (
      <Screen withTabBar>
        <ErrorState message={copy.common.error} />
        <Button
          label={copy.home.rotationRetry}
          variant="secondary"
          onPress={() => {
            void membersQuery.refetch();
            onRefresh();
          }}
        />
      </Screen>
    );
  }

  if (current.role === 'successor') {
    return (
      <Screen withTabBar accessibilityLabel={copy.home.successorTitle}>
        <Title>{copy.home.successorTitle}</Title>
        <Body>{copy.home.successorBody}</Body>
        <Button
          label={copy.auth.signOut}
          variant="secondary"
          busy={signingOut}
          onPress={() => void onSignOut()}
        />
      </Screen>
    );
  }

  const memberPeople = (membersQuery.data ?? []).map((row) => ({
    id: row.userId,
    name: memberDisplayName(row.displayName),
  }));
  return (
    <Screen
      withTabBar
      testID="home"
      accessibilityLabel={current.space.name}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <SecurityStatusCard
        attentionOnly
        keyStatus={keyStatusQuery.data}
        recoveryStatus={recoveryQuery.data?.status}
        keyHolder={keyHolder}
        admin={admin}
        familyName={current.space.name}
        keysTestID="home-keys-status"
        recoveryTestID="home-recovery-status"
        rowTestID={
          keyStatusQuery.data === 'waitingOwnPhone' ? 'screen-waiting-own-phone' : undefined
        }
      />
      {shownRotation === 'updating' ? (
        <Muted testID="home-rotation-status">{copy.home.rotationUpdating}</Muted>
      ) : null}
      {shownRotation === 'upToDate' ? (
        <Muted testID="home-rotation-status">{copy.home.rotationUpToDate}</Muted>
      ) : null}
      {shownRotation === 'failed' ? (
        <View>
          <Muted testID="home-rotation-status">{copy.home.rotationFailed}</Muted>
          <Button
            label={copy.home.rotationRetry}
            variant="secondary"
            onPress={() => setRotationAttempt((n) => n + 1)}
          />
        </View>
      ) : null}
      {keyHolder && keyStatusQuery.data === 'ready' && (recoveryQuery.data?.accepted ?? 0) < 2 ? (
        <Card>
          <Title>{copy.home.recoveryCardTitle}</Title>
          <Muted>{copy.home.recoveryCardBody}</Muted>
          <Button
            label={copy.home.recoveryCardAction}
            onPress={() => router.push(routes.recoverySetup)}
          />
        </Card>
      ) : null}
      {keyHolder &&
      recoveryQuery.data &&
      recoveryQuery.data.accepted >= 2 &&
      !recoveryQuery.data.hasPaper ? (
        <Button
          label={copy.home.recoveryPrintedAction}
          variant="secondary"
          testID="create-printed-code"
          onPress={() => router.push(routes.printedCode)}
        />
      ) : null}
      {(recoveryQuery.data?.pending ?? [])
        .filter((row) => row.userId === userId)
        .map((row) => (
          <Card key={row.id}>
            <Title>{copy.home.recoveryInviteTitle}</Title>
            <Muted>{copy.home.recoveryInviteBody}</Muted>
            <Button
              label={copy.home.recoveryAccept}
              onPress={() => void onRecoveryRespond(true)}
            />
            <Button
              label={copy.home.recoveryDecline}
              variant="secondary"
              onPress={() => void onRecoveryRespond(false)}
            />
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
      {noticeError ? <ErrorState message={noticeError} /> : null}
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
        const title = copy.home.letInNotice.replace('{name}', name);
        return (
          <Card key={notice.id}>
            <Title testID="let-in-notice">{title}</Title>
            <Muted>
              {member ? copy.roles[member.role] : ''}
              {member ? ' · ' : ''}
              {setUp}
            </Muted>
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
          </Card>
        );
      })}
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Overline tone="terracotta">{homeDateOverline()}</Overline>
          <Display testID="home-greeting" style={styles.greetingLine}>
            {homeGreeting()}
          </Display>
          <DisplayItalic testID="home-family-name" tone="primary" style={styles.greetingLine}>
            {homeFamilyLine(current.space.name)}
          </DisplayItalic>
        </View>
        <Pressable
          testID="home-avatars"
          accessibilityRole="button"
          accessibilityLabel={copy.home.avatarsLabel}
          onPress={() => router.push(routes.family)}
          style={styles.avatars}
        >
          <AvatarStack people={memberPeople} />
        </Pressable>
      </View>
      <HomeToday />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  headerCopy: {
    flex: 1,
    gap: 0,
  },
  greetingLine: {
    // Tighter than default Display so "Good evening," and the family line sit close.
    marginTop: -4,
  },
  avatars: {
    minHeight: 44,
    justifyContent: 'center',
  },
  joinLink: {
    alignSelf: 'center',
    paddingVertical: space.md,
  },
});
