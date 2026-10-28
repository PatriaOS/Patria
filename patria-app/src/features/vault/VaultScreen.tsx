import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  Banner,
  Button,
  Caption,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { personalKeyNeedsOtherPhone } from '../../lib/crypto/keyStore';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import type { VaultDecisionContent } from '../../lib/crypto/vaultEnvelope';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { isKeyEligibleRole, isVaultWriterRole } from '../../lib/roles';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatVaultDate, vaultAuthorLabel } from './vaultAuthor';
import { formatVoiceLength, openVaultEntryContent } from './vaultOpen';
import { loadFamilyKeyForVault } from './useFamilyKey';
import { fetchVaultEntries, type VaultEntryRow } from './vaultApi';

export type VaultListItem = {
  id: string;
  createdAt: string;
  authorId: string;
  authorLabel: string;
  visibility: VaultEntryRow['visibility'];
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
  rows: VaultEntryRow[],
  members: { userId: string; displayName: string }[],
  keys: { familyKey: Uint8Array | null; personalKey: Uint8Array | null },
): VaultListItem[] {
  return rows
    .filter((row) => row.parentEntryId == null)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      authorId: row.authorId,
      authorLabel: vaultAuthorLabel(row.authorId, members),
      visibility: row.visibility,
      content: openVaultEntryContent(row, keys),
    }));
}

export function VaultScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, spaceId, current, keyHolder } = useCurrentFamily();
  const role = current?.role;

  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, role],
    enabled: Boolean(spaceId && userId && current && isKeyEligibleRole(role)),
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
    enabled: Boolean(spaceId && userId && current),
    queryFn: async () => {
      const [rows, members] = await Promise.all([
        fetchVaultEntries(spaceId as string),
        fetchMembers(spaceId as string),
      ]);
      const familyKey =
        keyHolder && keyStatusQuery.data === 'ready'
          ? await loadFamilyKeyForVault(userId as string, spaceId as string)
          : null;
      let personalKey: Uint8Array | null = null;
      let needsOtherPhone = false;
      try {
        personalKey = await loadPersonalKeyIfPresent({
          spaceId: spaceId as string,
          userId: userId as string,
        });
      } catch (error) {
        if (error instanceof Error && error.message === personalKeyNeedsOtherPhone) {
          needsOtherPhone = true;
        } else {
          throw error;
        }
      }
      try {
        return {
          locked: !familyKey && rows.some((row) => row.visibility === 'family'),
          needsOtherPhone,
          items: decryptRoots(rows, members, { familyKey, personalKey }),
        };
      } finally {
        if (familyKey) {
          wipe(familyKey);
        }
        if (personalKey) {
          wipe(personalKey);
        }
      }
    },
  });

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setPullRefreshing(true);
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['vaultEntries', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['familyKeyStatus', spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['recoverySnapshot', spaceId] });
    }
    requestAnimationFrame(() => setPullRefreshing(false));
  }, [queryClient, spaceId]);

  const writer = canWriteVault({
    role,
    keyReady: keyStatusQuery.data === 'ready',
    acceptedContacts: recoveryQuery.data?.accepted ?? 0,
    hasRecoveryPublic: Boolean(recoveryQuery.data?.hasRecoveryPublic),
  });
  const needsRecovery =
    isVaultWriterRole(role) &&
    keyStatusQuery.data === 'ready' &&
    ((recoveryQuery.data?.accepted ?? 0) < 2 || !recoveryQuery.data?.hasRecoveryPublic);

  if (!current || (isKeyEligibleRole(role) && keyStatusQuery.isLoading) || recoveryQuery.isLoading) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (isKeyEligibleRole(role) && keyStatusQuery.data && keyStatusQuery.data !== 'ready') {
    const privateItems = entriesQuery.data?.items.filter((item) => item.visibility === 'private') ?? [];
    if (privateItems.length === 0 && !entriesQuery.data?.needsOtherPhone) {
      return (
        <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
          <EmptyState title={copy.vault.title} message={copy.vault.waitingPhone} />
        </Screen>
      );
    }
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

  if (!isKeyEligibleRole(role) && items.length === 0 && !writer) {
    return (
      <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
        <EmptyState title={copy.vault.title} message={copy.vault.notForYou} />
      </Screen>
    );
  }

  return (
    <Screen
      withTabBar
      testID="screen-vault"
      accessibilityLabel={copy.vault.title}
      refreshing={pullRefreshing}
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
      {entriesQuery.data?.needsOtherPhone ? (
        <Banner message={copy.vault.approveOtherPhone} tone="warning" />
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
          const voiceLine = item.content?.audio
            ? formatVoiceLength(item.content.audio.durationSeconds)
            : '';
          const body = [item.authorLabel, formatVaultDate(item.createdAt), forLine, voiceLine]
            .filter(Boolean)
            .join(' · ');
          return (
            <ListRow
              key={item.id}
              title={title}
              body={body}
              trailing={
                item.visibility === 'private' ? (
                  <StatusPill label={copy.vault.onlyMe} tone="neutral" testID="only-me-badge" />
                ) : undefined
              }
              onPress={() => router.push(routes.vaultEntry(item.id))}
            />
          );
        })
      )}
    </Screen>
  );
}
