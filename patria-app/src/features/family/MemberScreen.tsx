import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Body,
  Button,
  ChoiceChip,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import { fetchAdminMemberEmail, fetchMembers } from '../../lib/family';
import {
  homeRotationQueryKey,
  homeRotationUiFromOutcome,
  rotateFamilyKeyIfNeeded,
} from '../../lib/crypto/rotateFamilyKey';
import { leaveFamilySpace } from '../../lib/leaveFamily';
import {
  countAdmins,
  INVITE_ROLES,
  isKeyEligibleRole,
  isSpaceAdmin,
  type SpaceRole,
} from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { fetchFamilyTimezone, fetchLetters } from '../letters/letterApi';
import { LeaveLettersChoice } from '../letters/LeaveLettersChoice';
import { lettersToDecideOnLeave, withdrawIdsForLeave } from '../letters/leaveLetters';
import { defaultTimezone } from '../sync/syncLabels';

type MemberScreenProps = {
  userId: string;
};

export function MemberScreen({ userId }: MemberScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [roleOverride, setRoleOverride] = useState<SpaceRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawChosen, setWithdrawChosen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });
  const emailQuery = useQuery({
    queryKey: ['member-email', spaceId, userId],
    enabled: Boolean(spaceId) && isSpaceAdmin(
      membersQuery.data?.find((row) => row.userId === session?.user.id)?.role,
    ),
    queryFn: () => fetchAdminMemberEmail(spaceId as string, userId),
  });

  const isSelf = session?.user.id === userId;
  const lettersQuery = useQuery({
    queryKey: ['lettersForLeave', spaceId, userId],
    enabled: Boolean(spaceId) && isSelf,
    queryFn: async () => {
      const [rows, timeZone] = await Promise.all([
        fetchLetters(spaceId as string),
        fetchFamilyTimezone(spaceId as string),
      ]);
      return {
        letters: lettersToDecideOnLeave(rows, userId),
        timeZone: timeZone ?? defaultTimezone(),
      };
    },
  });
  const leaveLetters = lettersQuery.data?.letters;

  const member = membersQuery.data?.find((row) => row.userId === userId);
  const role = roleOverride ?? member?.role ?? 'teen';
  const myRole = membersQuery.data?.find((row) => row.userId === session?.user.id)?.role;
  const admin = isSpaceAdmin(myRole);
  const adminCount = countAdmins((membersQuery.data ?? []).map((row) => row.role));
  const isLastAdmin = isSpaceAdmin(member?.role) && adminCount <= 1;
  const cannotLeave = Boolean(isSelf && isSpaceAdmin(myRole) && adminCount <= 1);

  if (membersQuery.isLoading || !member) {
    return (
      <Screen withHeader>
        {membersQuery.isLoading ? (
          <LoadingState message={copy.common.loading} />
        ) : (
          <ErrorState message={copy.common.empty} />
        )}
      </Screen>
    );
  }

  const saveRole = async () => {
    if (!spaceId || isLastAdmin) {
      return;
    }
    setError(null);
    const { error: updateError } = await supabase
      .from('space_members')
      .update({ role })
      .eq('family_space_id', spaceId)
      .eq('user_id', userId);
    if (updateError) {
      logFailedAction(updateError);
      setError(copy.member.saveFailed);
      return;
    }
    router.replace('/(signed-in)/home');
  };

  const remove = () => {
    if (!spaceId || isLastAdmin) {
      return;
    }
    Alert.alert(copy.member.remove, copy.member.removeConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.member.remove,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error: deleteError } = await supabase
              .from('space_members')
              .delete()
              .eq('family_space_id', spaceId)
              .eq('user_id', userId);
            if (deleteError) {
              logFailedAction(deleteError);
              setError(copy.member.removeFailed);
              return;
            }
            void queryClient.invalidateQueries({ queryKey: ['members', spaceId] });
            queryClient.setQueryData(homeRotationQueryKey(spaceId), 'updating');
            router.replace('/(signed-in)/home');
            const adminId = session?.user.id;
            let outcome = await rotateFamilyKeyIfNeeded({
              spaceId,
              userId: adminId ?? '',
              role: myRole,
            });
            if (outcome === 'idle' && isKeyEligibleRole(member.role)) {
              outcome = await rotateFamilyKeyIfNeeded({
                spaceId,
                userId: adminId ?? '',
                role: myRole,
              });
            }
            if (outcome !== 'idle') {
              queryClient.setQueryData(
                homeRotationQueryKey(spaceId),
                homeRotationUiFromOutcome(outcome),
              );
            } else if (!isKeyEligibleRole(member.role)) {
              queryClient.setQueryData(homeRotationQueryKey(spaceId), 'hidden');
            }
          })();
        },
      },
    ]);
  };

  const confirmLeave = (withdrawLetterIds?: string[]) => {
    const myId = session?.user.id;
    if (!spaceId || !myId) {
      return;
    }
    Alert.alert(copy.member.leave, copy.member.leaveConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.member.leave,
        style: 'destructive',
        onPress: () => {
          void leaveFamilySpace({
            spaceId,
            userId: myId,
            ...(withdrawLetterIds ? { withdrawLetterIds } : {}),
          }).then((result) => {
            if (!result.ok) {
              setError(copy.member.leaveFailed);
              return;
            }
            router.replace('/(signed-in)/home');
          });
        },
      },
    ]);
  };

  const leave = () => {
    const myId = session?.user.id;
    if (!spaceId || !myId || cannotLeave) {
      return;
    }
    setError(null);
    const letters = leaveLetters ?? lettersToDecideOnLeave([], myId);
    if (letters.sealed.length > 0 || letters.draftIds.length > 0) {
      confirmLeave(withdrawIdsForLeave(letters, withdrawChosen));
      return;
    }
    confirmLeave();
  };

  return (
    <Screen accessibilityLabel={member.displayName} withHeader>
      <Title>{member.displayName}</Title>
      <Body>{copy.roles[member.role]}</Body>
      {emailQuery.data ? <Muted>{emailQuery.data}</Muted> : null}
      {admin ? (
        <>
          <Muted>{copy.member.roleLabel}</Muted>
          <View style={styles.chips}>
            {INVITE_ROLES.map((item) => (
              <ChoiceChip
                key={item}
                testID={`role-${testIdFromLabel(copy.roles[item])}`}
                label={copy.roles[item]}
                selected={role === item}
                onPress={() => setRoleOverride(item)}
              />
            ))}
          </View>
          {isLastAdmin ? <Muted>{copy.member.lastAdmin}</Muted> : null}
          {error ? <ErrorState message={error} /> : null}
          <Button
            label={copy.member.changeRole}
            testID="save-role"
            onPress={() => void saveRole()}
            disabled={isLastAdmin}
          />
          <Button
            label={copy.member.remove}
            variant="danger"
            testID="remove-from-this-family"
            onPress={remove}
            disabled={isLastAdmin}
          />
        </>
      ) : null}
      {isSelf && !cannotLeave ? (
        <>
          {error && !admin ? <ErrorState message={error} /> : null}
          {leaveLetters && leaveLetters.sealed.length > 0 ? (
            <LeaveLettersChoice
              letters={leaveLetters.sealed}
              recipientName={(recipientId) =>
                membersQuery.data?.find((row) => row.userId === recipientId)?.displayName ??
                copy.letters.formerMember
              }
              timeZone={lettersQuery.data?.timeZone ?? defaultTimezone()}
              withdrawChosen={withdrawChosen}
              onChange={(letterId, withdraw) =>
                setWithdrawChosen((previous) => {
                  const next = new Set(previous);
                  if (withdraw) {
                    next.add(letterId);
                  } else {
                    next.delete(letterId);
                  }
                  return next;
                })
              }
            />
          ) : null}
          <Button
            label={copy.member.leave}
            variant="danger"
            testID="leave-family"
            onPress={leave}
            disabled={lettersQuery.isLoading}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
