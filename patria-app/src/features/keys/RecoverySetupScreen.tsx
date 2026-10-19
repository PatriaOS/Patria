import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import {
  Body,
  Button,
  Card,
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
import { fetchMembers } from '../../lib/family';
import { isKeyEligibleRole } from '../../lib/roles';
import {
  approvedIdsFromEligibleContacts,
  inviteRecoveryContacts,
  loadEligibleRecoveryContacts,
  loadRecoverySnapshot,
  removeRecoveryContact,
  rotateRecoveryKey,
  selectableRecoveryContacts,
} from '../../lib/crypto/recoverySetup';
import { memberDisplayName } from '../../lib/displayName';
import { routes } from '../../lib/navigation';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme';

export function RecoverySetupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });
  const snapshotQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () =>
      loadRecoverySnapshot(spaceId as string, userId as string, 'family_admin'),
  });
  const eligibleQuery = useQuery({
    queryKey: ['recoveryEligibleContacts', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => loadEligibleRecoveryContacts(spaceId as string),
  });

  const myRole = membersQuery.data?.find((row) => row.userId === userId)?.role;
  if (
    !spaceId ||
    membersQuery.isLoading ||
    snapshotQuery.isLoading ||
    eligibleQuery.isLoading
  ) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (membersQuery.error || snapshotQuery.error || eligibleQuery.error) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }
  if (!isKeyEligibleRole(myRole) || !userId) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const snapshot = snapshotQuery.data;
  const eligible = eligibleQuery.data ?? [];
  const approved = approvedIdsFromEligibleContacts(eligible);
  const selectable = selectableRecoveryContacts(
    membersQuery.data ?? [],
    approved,
    userId,
  ).filter(
    (row) =>
      !(snapshot?.ownContacts ?? []).some(
        (contact) => contact.userId === row.userId && contact.status !== 'declined',
      ),
  );
  const openSlots = 2 - (snapshot?.ownContacts.filter((row) => row.status !== 'declined').length ?? 0);

  const toggle = (id: string) => {
    setPicked((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= openSlots) {
        return current;
      }
      return [...current, id];
    });
  };

  const onInvite = async () => {
    if (picked.length === 0 || picked.length > openSlots) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const ids = picked as [string] | [string, string];
      await inviteRecoveryContacts({
        spaceId,
        createdBy: userId,
        contactUserIds: ids,
        members: membersQuery.data ?? [],
        approvedUserIds: approved,
      });
      await queryClient.invalidateQueries({ queryKey: ['recoverySnapshot'] });
      setPicked([]);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.recovery.pickFailed);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (contactUserId: string) => {
    setError(null);
    setBusy(true);
    try {
      await removeRecoveryContact({
        spaceId,
        contactUserId,
      });
      await queryClient.invalidateQueries({ queryKey: ['recoverySnapshot'] });
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.recovery.rotateFailed);
    } finally {
      setBusy(false);
    }
  };

  const onPaperLost = async () => {
    setError(null);
    setBusy(true);
    try {
      await rotateRecoveryKey({
        spaceId,
        memberUserId: userId,
      });
      await queryClient.invalidateQueries({ queryKey: ['recoverySnapshot'] });
      router.push(routes.printedCode);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.recovery.rotateFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen withHeader accessibilityLabel={copy.recovery.title}>
      <Title>{copy.recovery.title}</Title>
      <Body>{copy.recovery.pickBody}</Body>
      {error ? <ErrorState message={error} /> : null}
      {(snapshot?.ownContacts ?? [])
        .filter((row) => row.status !== 'declined')
        .map((contact) => {
          const member = membersQuery.data?.find((row) => row.userId === contact.userId);
          return (
            <Card key={contact.id}>
              <Title>{memberDisplayName(member?.displayName)}</Title>
              <Muted>
                {contact.status === 'accepted'
                  ? copy.recovery.accepted
                  : copy.recovery.waitingAccept}
              </Muted>
              {contact.status === 'accepted' ? (
                <Button
                  label={copy.recovery.removeContact}
                  variant="secondary"
                  testID="remove-as-recovery-contact"
                  busy={busy}
                  onPress={() => void onRemove(contact.userId)}
                />
              ) : null}
            </Card>
          );
        })}
      {selectable.map((row) => {
        const member = membersQuery.data?.find((item) => item.userId === row.userId);
        const eligibleRow = eligible.find((item) => item.userId === row.userId);
        const name = memberDisplayName(eligibleRow?.displayName ?? member?.displayName);
        const selected = picked.includes(row.userId);
        return (
          <Pressable
            key={row.userId}
            testID={`recovery-contact-${testIdFromLabel(name)}`}
            accessibilityRole="button"
            accessibilityLabel={name}
            onPress={() => toggle(row.userId)}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.hairline },
            ]}
          >
            <Body>{name}</Body>
            <Muted>{copy.roles[row.role]}</Muted>
          </Pressable>
        );
      })}
      {openSlots > 0 ? (
        <Button
          label={copy.recovery.pickAction}
          busy={busy}
          disabled={picked.length === 0}
          onPress={() => void onInvite()}
        />
      ) : null}
      {snapshot && snapshot.accepted >= 2 && !snapshot.hasPaper ? (
        <Button
          label={copy.home.recoveryPrintedAction}
          variant="secondary"
          testID="create-printed-code"
          onPress={() => router.push(routes.printedCode)}
        />
      ) : null}
      {snapshot?.hasPaper ? (
        <Button
          label={copy.recovery.paperLost}
          variant="secondary"
          busy={busy}
          onPress={() => void onPaperLost()}
        />
      ) : null}
      {snapshot?.hasRecoveryPublic && snapshot.accepted < 2 ? (
        <Button
          label={copy.recovery.redoSetup}
          variant="secondary"
          busy={busy}
          onPress={() => void onPaperLost()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 22,
    padding: space.card,
    gap: space.xs,
    borderWidth: 1,
  },
});
