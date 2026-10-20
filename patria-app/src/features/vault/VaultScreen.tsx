import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  Banner,
  Button,
  Caption,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../ui';
import { copy } from '../../lib/copy';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { openVaultDecision, type VaultDecisionContent } from '../../lib/crypto/vaultEnvelope';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { isKeyEligibleRole, isVaultWriterRole } from '../../lib/roles';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatVaultDate, vaultAuthorLabel } from './vaultAuthor';
import { loadFamilyKeyForVault, withFamilyKey } from './useFamilyKey';
import { fetchVaultEntries, type VaultEntryRow } from './vaultApi';

export type VaultListItem = {
  id: string;
  createdAt: string;
  authorId: string;
  authorLabel: string;
  content: VaultDecisionContent | null;
};

export function canWriteVault(input: {
  role: string | null | undefined;
  keyReady: boolean;
  acceptedContacts: number;
  hasRecoveryPublic: boolean;
}): boolean {
  return (
    isVaultWriterRole(input.role) &&
    input.keyReady &&
    input.acceptedContacts >= 2 &&
    input.hasRecoveryPublic
  );
}

function decryptRoots(
  familyKey: Uint8Array,
  rows: VaultEntryRow[],
  members: { userId: string; displayName: string }[],
): VaultListItem[] {
  return rows
    .filter((row) => row.parentEntryId == null)
    .map((row) => {
      let content: VaultDecisionContent | null = null;
      try {
        content = openVaultDecision(familyKey, row.sealed, {
          familySpaceId: row.familySpaceId,
          entryId: row.id,
          version: row.version,
          authorId: row.authorId,
          keyEpoch: row.keyEpoch,
        });
      } catch {
        content = null;
      }
      return {
        id: row.id,
        createdAt: row.createdAt,
        authorId: row.authorId,
        authorLabel: vaultAuthorLabel(row.authorId, members),
        content,
      };
    });
}

export function VaultScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, spaceId, current, keyHolder } = useCurrentFamily();
  const role = current?.role;

  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, role],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () =>
      ensureKeysForOpenFamily({
        spaceId: spaceId as string,
        userId: userId as string,
        role,
      }),
  });

  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, role),
  });

  const entriesQuery = useQuery({
    queryKey: ['vaultEntries', spaceId, userId],
    enabled: Boolean(spaceId && userId && keyHolder && keyStatusQuery.data === 'ready'),
    queryFn: async () => {
      const [rows, members] = await Promise.all([
        fetchVaultEntries(spaceId as string),
        fetchMembers(spaceId as string),
      ]);
      const familyKey = await loadFamilyKeyForVault(userId as string, spaceId as string);
      if (!familyKey) {
        return { locked: true as const, items: [] as VaultListItem[] };
      }
      return withFamilyKey(familyKey, (key) => ({
        locked: false as const,
        items: decryptRoots(key, rows, members),
      }));
    },
  });

  const onRefresh = useCallback(() => {
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['vaultEntries', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['familyKeyStatus', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['recoverySnapshot', spaceId] });
    }
  }, [queryClient, spaceId]);

  const keyReady = keyStatusQuery.data === 'ready';
  const writer = canWriteVault({
    role,
    keyReady,
    acceptedContacts: recoveryQuery.data?.accepted ?? 0,
    hasRecoveryPublic: Boolean(recoveryQuery.data?.hasRecoveryPublic),
  });
  const needsRecovery =
    isVaultWriterRole(role) &&
    keyReady &&
    ((recoveryQuery.data?.accepted ?? 0) < 2 || !recoveryQuery.data?.hasRecoveryPublic);

  if (!current || keyStatusQuery.isLoading || recoveryQuery.isLoading) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!isKeyEligibleRole(role)) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <EmptyState title={copy.vault.title} message={copy.vault.notForYou} />
      </Screen>
    );
  }

  if (keyStatusQuery.data && keyStatusQuery.data !== 'ready') {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <EmptyState title={copy.vault.title} message={copy.vault.waitingPhone} />
      </Screen>
    );
  }

  if (entriesQuery.isLoading) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (entriesQuery.isError) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const items = entriesQuery.data?.items ?? [];
  const locked = entriesQuery.data?.locked === true;

  return (
    <Screen
      withTabBar
      testID="screen-vault"
      accessibilityLabel={copy.vault.title}
      refreshing={entriesQuery.isFetching}
      onRefresh={onRefresh}
    >
      <Caption>{copy.vault.lockNote}</Caption>
      {needsRecovery ? (
        <Banner
          message={copy.vault.recoveryFirst}
          action={
            <Button
              label={copy.vault.recoveryFirstAction}
              variant="secondary"
              onPress={() => router.push(routes.recoverySetup)}
            />
          }
        />
      ) : null}
      {locked ? <Banner message={copy.vault.noKey} tone="warning" /> : null}
      {writer ? (
        <Button label={copy.vault.newDecision} onPress={() => router.push(routes.vaultNew)} />
      ) : null}
      {items.length === 0 ? (
        <EmptyState title={copy.vault.emptyTitle} message={copy.vault.emptyBody} compact />
      ) : (
        items.map((item) => {
          const title = item.content?.title ?? copy.vault.openFailed;
          const forLine = item.content?.for ? `For ${item.content.for}` : '';
          const body = [item.authorLabel, formatVaultDate(item.createdAt), forLine]
            .filter(Boolean)
            .join(' · ');
          return (
            <ListRow
              key={item.id}
              title={title}
              body={body}
              onPress={() => router.push(routes.vaultEntry(item.id))}
            />
          );
        })
      )}
    </Screen>
  );
}
