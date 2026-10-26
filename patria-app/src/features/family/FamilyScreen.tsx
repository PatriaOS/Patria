import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { signOutAndGoWelcome } from '../../lib/authSession';
import { copy } from '../../lib/copy';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { writeCurrentFamilyId } from '../../lib/currentFamily';
import { fetchChildren, fetchMembers, fetchPendingInvites } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { countAdmins } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { SecurityStatusCard } from './SecurityStatusCard';
import { useCurrentFamily } from './useCurrentFamily';

export function FamilyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { userId, spaceId, setSpaceId, membershipsQuery, current, admin, keyHolder } =
    useCurrentFamily();
  const [signingOut, setSigningOut] = useState(false);

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    refetchOnMount: 'always',
    queryFn: () => fetchMembers(spaceId as string),
  });
  const childrenQuery = useQuery({
    queryKey: ['children', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchChildren(spaceId as string),
  });
  const invitesQuery = useQuery({
    queryKey: ['invites', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchPendingInvites(spaceId as string),
  });
  // Same keys as Home so the two tabs share one read; keys and recovery status live here (D35).
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
  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    refetchOnMount: 'always',
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, current?.role),
  });

  const onRefresh = useCallback(() => {
    if (userId) {
      void queryClient.invalidateQueries({ queryKey: ['memberships', userId] });
    }
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['members', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['children', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['invites', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['familyKeyStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['recoverySnapshot', spaceId, userId] });
    }
  }, [queryClient, spaceId, userId]);

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
  const createAnotherFamilyLink = (
    <Pressable
      testID={testIdFromLabel(copy.home.createAnotherFamily)}
      accessibilityRole="link"
      accessibilityLabel={copy.home.createAnotherFamily}
      onPress={() => router.push(routes.createFamily)}
      style={styles.joinLink}
    >
      <Muted tone="primary">{copy.home.createAnotherFamily}</Muted>
    </Pressable>
  );

  const refreshing =
    membershipsQuery.isRefetching ||
    membersQuery.isRefetching ||
    childrenQuery.isRefetching ||
    invitesQuery.isRefetching;
  const adminCount = countAdmins((membersQuery.data ?? []).map((row) => row.role));

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
        testID="screen-family"
        accessibilityLabel={copy.tabs.family}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <Title>{copy.tabs.family}</Title>
        <Title>{copy.home.noFamilyTitle}</Title>
        <Body>{copy.home.noFamilyBody}</Body>
        <Button label={copy.createFamily.submit} onPress={() => router.push(routes.createFamily)} />
        {joinFamilyLink}
        <Button
          label={copy.appearance.title}
          variant="secondary"
          onPress={() => router.push(routes.appearance)}
        />
        <Button
          label={copy.auth.signOut}
          variant="secondary"
          busy={signingOut}
          onPress={() => void onSignOut()}
        />
      </Screen>
    );
  }

  if (membersQuery.error) {
    return (
      <Screen withTabBar testID="screen-family">
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

  return (
    <Screen
      withTabBar
      testID="screen-family"
      accessibilityLabel={copy.tabs.family}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Title>{copy.tabs.family}</Title>
      <Title testID="family-name">{current.space.name}</Title>

      {(membershipsQuery.data ?? []).length > 1 ? (
        <View>
          <Muted>{copy.home.switcherLabel}</Muted>
          {(membershipsQuery.data ?? []).map((item) => (
            <Pressable
              key={item.space.id}
              testID={`family-${testIdFromLabel(item.space.name)}`}
              accessibilityRole="button"
              accessibilityLabel={item.space.name}
              onPress={() => {
                setSpaceId(item.space.id);
                void writeCurrentFamilyId(item.space.id);
              }}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.hairline },
                item.space.id === spaceId && { borderColor: colors.primary, borderWidth: 1 },
              ]}
            >
              <Body>{item.space.name}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Body>{copy.home.membersTitle}</Body>
      {membersQuery.isLoading || childrenQuery.isLoading ? (
        <LoadingState message={copy.common.loading} />
      ) : null}
      {!membersQuery.isLoading &&
      !childrenQuery.isLoading &&
      (membersQuery.data ?? []).length <= 1 &&
      (childrenQuery.data ?? []).length === 0 ? (
        <EmptyState title={copy.home.emptyMembers} />
      ) : null}
      {(membersQuery.data ?? []).map((row) => {
        const peerIds = [
          ...(membersQuery.data ?? []).map((member) => member.userId),
          ...(childrenQuery.data ?? []).map((child) => child.id),
        ];
        return (
          <Pressable
            key={row.id}
            testID={`member-${testIdFromLabel(row.displayName)}`}
            accessibilityRole="button"
            accessibilityLabel={`${row.displayName}, ${copy.roles[row.role]}`}
            disabled={!admin && row.userId !== userId}
            onPress={() => router.push(routes.member(row.userId))}
          >
            <Card>
              <View style={styles.memberRow}>
                <Avatar id={row.userId} name={row.displayName} peerIds={peerIds} size={40} decorative />
                <View style={styles.memberCopy}>
                  <Body>
                    {row.displayName}
                    {row.userId === userId ? ` · ${copy.invite.youBadge}` : ''}
                  </Body>
                  <Muted>
                    {row.relationshipLabel ? `${row.relationshipLabel} · ` : ''}
                    {copy.roles[row.role]}
                  </Muted>
                </View>
              </View>
            </Card>
          </Pressable>
        );
      })}
      {(childrenQuery.data ?? []).map((child) => {
        const subtitle = `${copy.roles.child} · ${copy.child.noEmail}`;
        const peerIds = [
          ...(membersQuery.data ?? []).map((member) => member.userId),
          ...(childrenQuery.data ?? []).map((row) => row.id),
        ];
        return (
          <Pressable
            key={child.id}
            accessible={false}
            importantForAccessibility="no"
            disabled={!admin}
            onPress={() => router.push(`/(signed-in)/child/${child.id}`)}
          >
            <Card>
              <View style={styles.memberRow}>
                <Avatar id={child.id} name={child.displayName} peerIds={peerIds} size={40} decorative />
                <View style={styles.memberCopy}>
                  <Body
                    testID={`child-${testIdFromLabel(child.displayName)}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${child.displayName}, ${copy.roles.child}`}
                  >
                    {child.displayName}
                  </Body>
                  <Muted
                    accessible
                    testID={`child-${testIdFromLabel(child.displayName)}-subtitle`}
                    accessibilityLabel={subtitle}
                  >
                    {subtitle}
                  </Muted>
                </View>
              </View>
            </Card>
          </Pressable>
        );
      })}

      {admin ? (
        <>
          <Button label={copy.home.invite} onPress={() => router.push(routes.inviteSomeone)} />
          <Button
            label={copy.home.addChild}
            variant="secondary"
            onPress={() => router.push(routes.addChild)}
          />
          <Muted>
            {copy.home.pendingInvites}: {invitesQuery.data?.length ?? 0}
          </Muted>
          <Button
            label={copy.recovery.title}
            variant="secondary"
            testID="recovery-contacts"
            onPress={() => router.push(routes.recoverySetup)}
          />
        </>
      ) : null}

      <Button
        label={copy.home.yourPhones}
        variant="secondary"
        testID="your-phones"
        onPress={() => router.push(routes.yourPhones)}
      />
      <SecurityStatusCard
        keyStatus={keyStatusQuery.data}
        recoveryStatus={recoveryQuery.data?.status}
        keyHolder={keyHolder}
        admin={admin}
        familyName={current.space.name}
        keysTestID="family-keys-status"
        recoveryTestID="family-recovery-status"
      />
      <Button
        label={copy.appearance.title}
        variant="secondary"
        onPress={() => router.push(routes.appearance)}
      />
      <Button
        label={copy.auth.signOut}
        variant="secondary"
        busy={signingOut}
        onPress={() => void onSignOut()}
      />
      {adminCount <= 1 && userId ? <Muted>{copy.member.lastAdmin}</Muted> : null}
      {createAnotherFamilyLink}
      {joinFamilyLink}
    </Screen>
  );
}

const styles = StyleSheet.create({
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  memberCopy: {
    flex: 1,
    gap: 2,
  },
  row: {
    borderRadius: 22,
    padding: space.card,
    gap: space.xs,
    borderWidth: 1,
  },
  joinLink: {
    alignSelf: 'center',
    paddingVertical: space.md,
  },
});
