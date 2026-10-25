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
  StatusPill,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { personalKeyNeedsOtherPhone } from '../../lib/crypto/keyStore';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';
import { logFailedAction } from '../../lib/devLog';
import { fetchMembers } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { type VaultDecisionContent } from '../../lib/crypto/vaultEnvelope';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { formatVaultDate, vaultAuthorLabel } from './vaultAuthor';
import { openVaultEntryContent } from './vaultOpen';
import { loadFamilyKeyForVault } from './useFamilyKey';
import { VoicePlayer } from './VoicePlayer';
import { deleteVaultEntry, fetchVaultEntries, type VaultEntryRow } from './vaultApi';

type Opened = {
  row: VaultEntryRow;
  content: VaultDecisionContent | null;
  authorLabel: string;
};

function openRow(
  keys: { familyKey: Uint8Array | null; personalKey: Uint8Array | null },
  row: VaultEntryRow,
  members: { userId: string; displayName: string }[],
): Opened {
  return {
    row,
    content: openVaultEntryContent(row, keys),
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
      let personalKey: Uint8Array | null = null;
      try {
        personalKey = await loadPersonalKeyIfPresent({
          spaceId: spaceId as string,
          userId: userId as string,
        });
      } catch (error) {
        if (!(error instanceof Error && error.message === personalKeyNeedsOtherPhone)) {
          throw error;
        }
      }
      try {
        const root = rows.find((row) => row.id === entryId);
        if (!root) {
          return null;
        }
        const keys = { familyKey, personalKey };
        return {
          root: openRow(keys, root, members),
          followUps: rows
            .filter((row) => row.parentEntryId === entryId)
            .map((row) => openRow(keys, row, members)),
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
        <ErrorState
          message={
            entryQuery.error instanceof Error &&
            entryQuery.error.message === personalKeyNeedsOtherPhone
              ? copy.vault.approveOtherPhone
              : copy.vault.openFailed
          }
        />
      </Screen>
    );
  }

  const { root, followUps } = entryQuery.data;
  const isAuthor = root.row.authorId === userId;
  const title = root.content?.title ?? copy.vault.openFailed;

  return (
    <Screen withHeader accessibilityLabel={title}>
      <Caption>
        {root.row.visibility === 'private' ? copy.vault.onlyMeHint : copy.vault.lockNote}
      </Caption>
      {root.row.visibility === 'private' ? (
        <StatusPill label={copy.vault.onlyMe} testID="only-me-badge" />
      ) : null}
      <Title>{title}</Title>
      <Muted>
        {root.authorLabel}
        {root.row.createdAt ? ` · ${formatVaultDate(root.row.createdAt)}` : ''}
      </Muted>
      {root.content?.for ? <Caption>For {root.content.for}</Caption> : null}
      {root.content ? <Body>{root.content.body}</Body> : <ErrorState message={copy.vault.openFailed} />}
      {root.content?.audio && spaceId ? (
        <VoicePlayer spaceId={spaceId} entryId={root.row.id} audio={root.content.audio} />
      ) : null}
      {isAuthor ? (
        <>
          <Button
            label={copy.vault.edit}
            variant="secondary"
            onPress={() =>
              router.push(`/(signed-in)/vault-new?entryId=${encodeURIComponent(entryId)}`)
            }
          />
          <Button
            label={copy.vault.followUp}
            onPress={() =>
              router.push(`/(signed-in)/vault-new?parentId=${encodeURIComponent(entryId)}`)
            }
          />
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
