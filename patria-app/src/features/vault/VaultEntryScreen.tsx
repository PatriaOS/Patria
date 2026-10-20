import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import {
  Body,
  Button,
  Caption,
  ErrorState,
  ListRow,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { openVaultDecision, type VaultDecisionContent } from '../../lib/crypto/vaultEnvelope';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatVaultDate, vaultAuthorLabel } from './vaultAuthor';
import { loadFamilyKeyForVault, withFamilyKey } from './useFamilyKey';
import { deleteVaultEntry, fetchVaultEntries, type VaultEntryRow } from './vaultApi';

type Opened = {
  row: VaultEntryRow;
  content: VaultDecisionContent | null;
  authorLabel: string;
};

function openRow(
  familyKey: Uint8Array,
  row: VaultEntryRow,
  members: { userId: string; displayName: string }[],
): Opened {
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
    row,
    content,
    authorLabel: vaultAuthorLabel(row.authorId, members),
  };
}

export function VaultEntryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ entryId?: string }>();
  const entryId = typeof params.entryId === 'string' ? params.entryId : '';
  const { userId, spaceId } = useCurrentFamily();

  const entryQuery = useQuery({
    queryKey: ['vaultEntry', spaceId, entryId, userId],
    enabled: Boolean(spaceId && userId && entryId),
    queryFn: async () => {
      const [rows, members] = await Promise.all([
        fetchVaultEntries(spaceId as string),
        fetchMembers(spaceId as string),
      ]);
      const familyKey = await loadFamilyKeyForVault(userId as string, spaceId as string);
      if (!familyKey) {
        return null;
      }
      return withFamilyKey(familyKey, (key) => {
        const root = rows.find((row) => row.id === entryId);
        if (!root) {
          return null;
        }
        return {
          root: openRow(key, root, members),
          followUps: rows
            .filter((row) => row.parentEntryId === entryId)
            .map((row) => openRow(key, row, members)),
        };
      });
    },
  });

  const onDelete = () => {
    Alert.alert(copy.vault.delete, copy.vault.deleteConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.vault.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteVaultEntry(entryId);
              void queryClient.invalidateQueries({ queryKey: ['vaultEntries', spaceId] });
              router.replace(routes.vault);
            } catch (error) {
              logFailedAction(error);
            }
          })();
        },
      },
    ]);
  };

  if (entryQuery.isLoading) {
    return (
      <Screen withHeader accessibilityLabel={copy.vault.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (entryQuery.isError || !entryQuery.data) {
    return (
      <Screen withHeader accessibilityLabel={copy.vault.title}>
        <ErrorState message={copy.vault.openFailed} />
      </Screen>
    );
  }

  const { root, followUps } = entryQuery.data;
  const isAuthor = root.row.authorId === userId;
  const title = root.content?.title ?? copy.vault.openFailed;

  return (
    <Screen withHeader accessibilityLabel={title}>
      <Caption>{copy.vault.lockNote}</Caption>
      <Title>{title}</Title>
      <Muted>
        {root.authorLabel}
        {root.row.createdAt ? ` · ${formatVaultDate(root.row.createdAt)}` : ''}
      </Muted>
      {root.content?.for ? <Caption>For {root.content.for}</Caption> : null}
      {root.content ? <Body>{root.content.body}</Body> : <ErrorState message={copy.vault.openFailed} />}
      {isAuthor ? (
        <>
          <Button
            label={copy.vault.edit}
            variant="secondary"
            onPress={() =>
              router.push(`/(signed-in)/vault-new?entryId=${encodeURIComponent(entryId)}`)
            }
          />
          <Button label={copy.vault.followUp} onPress={() =>
            router.push(`/(signed-in)/vault-new?parentId=${encodeURIComponent(entryId)}`)
          } />
          <Button label={copy.vault.delete} variant="danger" onPress={onDelete} />
        </>
      ) : null}
      {followUps.length > 0 ? <Title>{copy.vault.followUps}</Title> : null}
      {followUps.map((item) => (
        <ListRow
          key={item.row.id}
          title={item.content?.title ?? copy.vault.openFailed}
          body={[item.authorLabel, formatVaultDate(item.row.createdAt)].filter(Boolean).join(' · ')}
        />
      ))}
    </Screen>
  );
}
