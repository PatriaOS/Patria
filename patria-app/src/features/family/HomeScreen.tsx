import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import { Menu } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import {
  AvatarStack,
  Body,
  Button,
  Display,
  DisplayItalic,
  ErrorState,
  IconButton,
  LoadingState,
  Muted,
  Overline,
  Pressable,
  Screen,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { fetchMembers } from '../../lib/family';
import { signOutAndGoWelcome } from '../../lib/authSession';
import { fetchFirstDeviceNotices } from '../../lib/crypto/deviceAccess';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import {
  homeRotationQueryKey,
  homeRotationUiFromOutcome,
  rotateFamilyKeyIfNeeded,
  type HomeRotationUi,
  type RotationOutcome,
} from '../../lib/crypto/rotateFamilyKey';
import { supabaseRecoverFlowGateway } from '../../lib/crypto/recoverFlow';
import {
  fulfillAcceptedContacts,
  loadRecoverySnapshot,
} from '../../lib/crypto/recoverySetup';
import { memberDisplayName } from '../../lib/displayName';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { countDeviceOrJoinAttention } from './deviceAttention';
import { homeDateOverline, homeFamilyLine, homeGreeting } from './homeGreeting';
import { HomeMenuDrawer } from './HomeMenuDrawer';
import { HomeToday } from './HomeToday';
import { NeedsYouBell } from './NeedsYouBell';
import { buildNeedsYouItems } from './needsYou';
import { SecurityStatusCard } from './SecurityStatusCard';
import {
  hydrateRecoveryReminderShown,
  markRecoveryReminderShown,
  shouldOfferRecoveryReminder,
} from './recoveryReminderSession';
import { RecoveryReminderSheet } from './RecoveryReminderSheet';
import { useCurrentFamily } from './useCurrentFamily';
import { defaultTimezone } from '../sync/syncLabels';
import { fetchSyncMeetingAnswers, fetchSyncTasks } from '../sync/syncApi';
import { syncAnswersKey } from '../sync/syncQueryKeys';
import { useSyncSpace } from '../sync/useSyncSpace';

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { userId, spaceId, membershipsQuery, current, admin, keyHolder } = useCurrentFamily();
  const sync = useSyncSpace();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderHydrated, setReminderHydrated] = useState(false);
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
  const tasksQuery = useQuery({
    queryKey: ['syncTasks', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchSyncTasks(spaceId as string),
  });
  const syncAnswersQuery = useQuery({
    queryKey: syncAnswersKey(sync.active?.id),
    enabled: Boolean(sync.active?.id && sync.active.status === 'upcoming'),
    queryFn: () => fetchSyncMeetingAnswers(sync.active!.id),
  });
  // Focus / foreground: home data only. Memories stays on its own screen so
  // thumbnails are not invalidated while the person is looking at them.
  const refreshHomeData = useCallback(() => {
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
      void queryClient.invalidateQueries({ queryKey: ['syncSchedule', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncMeetings', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncAgenda'] });
      void queryClient.invalidateQueries({ queryKey: ['syncTasks', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['syncAnswers'] });
    }
  }, [queryClient, userId, spaceId]);

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setPullRefreshing(true);
    refreshHomeData();
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['memories', spaceId] });
    }
    // Spinner clears on next tick after invalidation is queued; isRefetching
    // must not drive RefreshControl or focus reloads look like a pull loop.
    requestAnimationFrame(() => setPullRefreshing(false));
  }, [queryClient, refreshHomeData, spaceId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshHomeData();
      }
    });
    return () => sub.remove();
  }, [refreshHomeData]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      refreshHomeData();
    });
    return unsubscribe;
  }, [navigation, refreshHomeData]);

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

  useEffect(() => {
    if (keyHolder && spaceId && userId && keyStatusQuery.data === 'ready') {
      if ((recoveryQuery.data?.accepted ?? 0) === 0) {
        return;
      }
      void fulfillAcceptedContacts({
        spaceId,
        memberUserId: userId,
      }).catch((caught: unknown) => {
        logFailedAction(caught);
      });
    }
  }, [keyHolder, spaceId, userId, keyStatusQuery.data, recoveryQuery.data?.accepted]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let cancelled = false;
    void hydrateRecoveryReminderShown(userId).then(() => {
      if (!cancelled) {
        setReminderHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (
      !userId ||
      !reminderHydrated ||
      !current ||
      menuOpen ||
      recoveryQuery.isLoading ||
      keyStatusQuery.isLoading
    ) {
      return;
    }
    const keysReady = keyStatusQuery.data === 'ready';
    if (
      !shouldOfferRecoveryReminder({
        userId,
        keyHolder,
        recoveryAccepted: recoveryQuery.data?.accepted ?? 0,
        hasPaper: Boolean(recoveryQuery.data?.hasPaper),
        onboarding: !keysReady,
      })
    ) {
      return;
    }
    const open = () => {
      setReminderOpen(true);
      void markRecoveryReminderShown(userId);
    };
    const handle = setTimeout(open, 0);
    return () => clearTimeout(handle);
  }, [
    userId,
    reminderHydrated,
    current,
    menuOpen,
    keyHolder,
    keyStatusQuery.isLoading,
    keyStatusQuery.data,
    recoveryQuery.isLoading,
    recoveryQuery.data?.accepted,
    recoveryQuery.data?.hasPaper,
  ]);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutAndGoWelcome({
        userId,
        signOut: () => supabase.auth.signOut(),
        replace: (href) => router.replace(href),
      });
    } finally {
      setSigningOut(false);
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
        refreshing={pullRefreshing}
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
  const selfName =
    (membersQuery.data ?? []).find((row) => row.userId === userId)?.displayName ?? '';

  const deviceOrJoinCount = countDeviceOrJoinAttention({
    userId,
    admin,
    keyStatus: keyStatusQuery.data,
    notices: noticesQuery.data ?? [],
    recoveryRequests: recoveryRequestsQuery.data ?? [],
    recovery: recoveryQuery.data,
    removedNoticeCount: (removedNoticesQuery.data ?? []).length,
  });
  const syncRsvpNeeded = Boolean(
    userId &&
      sync.active?.status === 'upcoming' &&
      !(syncAnswersQuery.data ?? []).some((row) => row.userId === userId),
  );
  const needsYouCount = buildNeedsYouItems({
    keyHolder,
    recoveryAccepted: recoveryQuery.data?.accepted ?? 0,
    hasPaper: Boolean(recoveryQuery.data?.hasPaper),
    recoveryStatus: recoveryQuery.data?.status,
    syncMeeting: sync.active,
    syncRsvpNeeded,
    timeZone: sync.schedule?.timezone ?? defaultTimezone(),
    userId,
    tasks: tasksQuery.data ?? [],
    deviceOrJoinCount,
  }).length;
  const recoveryNeedsDot =
    keyHolder &&
    ((recoveryQuery.data?.accepted ?? 0) < 2 ||
      ((recoveryQuery.data?.accepted ?? 0) >= 2 && !recoveryQuery.data?.hasPaper));

  return (
    <Screen
      withTabBar
      testID="home"
      accessibilityLabel={current.space.name}
      refreshing={pullRefreshing}
      onRefresh={onRefresh}
    >
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
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Overline tone="terracotta">{homeDateOverline()}</Overline>
          <Display testID="home-greeting">{homeGreeting()}</Display>
          <DisplayItalic testID="home-family-name" tone="primary">
            {homeFamilyLine(current.space.name)}
          </DisplayItalic>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            testID="home-avatars"
            accessibilityRole="button"
            accessibilityLabel={copy.home.avatarsLabel}
            onPress={() => router.push(routes.family)}
            style={styles.avatars}
          >
            <AvatarStack people={memberPeople} />
          </Pressable>
          <View style={styles.iconRow}>
            <NeedsYouBell count={needsYouCount} onPress={() => router.push(routes.needsYou)} />
            <IconButton
              icon={Menu}
              name="menu"
              accessibilityLabel={copy.home.openMenu}
              testID="home-menu"
              onPress={() => setMenuOpen(true)}
            />
          </View>
        </View>
      </View>
      <SecurityStatusCard
        attentionOnly
        keyStatus={keyStatusQuery.data}
        recoveryStatus={undefined}
        keyHolder={keyHolder}
        admin={admin}
        familyName={current.space.name}
        keysTestID="home-keys-status"
        recoveryTestID="home-recovery-status"
      />
      <HomeToday />
      <HomeMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        displayName={selfName}
        familyName={current.space.name}
        privacyNeedsAttention={recoveryNeedsDot}
        onSignOut={() => void onSignOut()}
      />
      <RecoveryReminderSheet
        visible={reminderOpen && !menuOpen}
        onSetUp={() => {
          setReminderOpen(false);
          router.push(routes.privacySecurity);
        }}
        onLater={() => setReminderOpen(false)}
      />
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
    gap: space.xxs,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
  avatars: {
    minHeight: 44,
    justifyContent: 'center',
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    minHeight: 44,
  },
  joinLink: {
    alignSelf: 'center',
    paddingVertical: space.md,
  },
});
