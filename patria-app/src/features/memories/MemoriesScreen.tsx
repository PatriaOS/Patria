import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { fetchMemberships } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { isMemoryRole } from '../../lib/roles';
import { colors, spacing, type } from '../../theme';
import { deleteConnection, fetchOwnConnection, patchConnection } from './libraryApi';
import { runLibrarySync } from './librarySync';
import {
  cleanupStaleUploads,
  clearImageCacheIfItemsLost,
  fetchReadyMemories,
  type MemoryItem,
} from './memoryApi';
import { formatDuration } from './shareMessages';

function formatTakenAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MemoriesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const previousIds = useRef<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [hasConnection, setHasConnection] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const membershipsQuery = useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchMemberships(userId as string),
  });
  const role = membershipsQuery.data?.find((item) => item.space.id === spaceId)?.role;

  const memoriesQuery = useQuery({
    queryKey: ['memories', spaceId],
    enabled: Boolean(spaceId) && isMemoryRole(role),
    queryFn: async (): Promise<MemoryItem[]> => fetchReadyMemories(spaceId as string),
  });

  const syncNow = useCallback(async () => {
    if (!userId || !spaceId || !isMemoryRole(role)) {
      return;
    }
    const device = await ensureDeviceIdentity(userId);
    const connection = await fetchOwnConnection(userId, spaceId, device.deviceId);
    setHasConnection(Boolean(connection));
    setPaused(Boolean(connection?.paused));
    if (!connection) {
      setStatus(null);
      return;
    }
    await runLibrarySync({
      userId,
      spaceId,
      deviceId: device.deviceId,
      confirm: (count, circleName) =>
        new Promise((resolve) => {
          Alert.alert(
            copy.memories.confirmShareTitle,
            copy.memories.confirmShareBody.replace('{count}', String(count)).replace('{circle}', circleName),
            [
              { text: copy.common.cancel, style: 'cancel', onPress: () => resolve(false) },
              { text: copy.memories.confirmShare, onPress: () => resolve(true) },
            ],
          );
        }),
      onProgress: (progress) => setStatus(progress.status),
    });
    const after = await fetchOwnConnection(userId, spaceId, device.deviceId);
    setPaused(Boolean(after?.paused));
    if (after?.needs_circle) {
      setStatus(copy.memories.statusChooseCircle);
    }
    await memoriesQuery.refetch();
    // refetch identity is stable; the query object is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync uses refetch only
  }, [userId, spaceId, role, memoriesQuery.refetch]);

  useEffect(() => {
    if (!userId || !isMemoryRole(role)) {
      return;
    }
    void cleanupStaleUploads(userId);
  }, [userId, role]);

  useEffect(() => {
    // Library sync on open (D31): pause, status and uploads live in React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- foreground sync is an external trigger
    void syncNow();
  }, [syncNow]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncNow();
      }
    });
    return () => sub.remove();
  }, [syncNow]);

  useEffect(() => {
    const ids = (memoriesQuery.data ?? []).map((item) => item.id);
    void clearImageCacheIfItemsLost(previousIds.current, ids).then(() => {
      previousIds.current = ids;
    });
  }, [memoriesQuery.data]);

  const onRefresh = useCallback(() => {
    void memoriesQuery.refetch();
    void syncNow();
  }, [memoriesQuery, syncNow]);

  const onPauseToggle = async () => {
    if (!userId || !spaceId) {
      return;
    }
    const device = await ensureDeviceIdentity(userId);
    const connection = await fetchOwnConnection(userId, spaceId, device.deviceId);
    if (!connection) {
      return;
    }
    await patchConnection(connection.id, { paused: !connection.paused });
    await syncNow();
  };

  const onDisconnect = () => {
    Alert.alert(copy.memories.disconnect, copy.memories.disconnectBody, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.memories.disconnect,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!userId || !spaceId) {
              return;
            }
            const device = await ensureDeviceIdentity(userId);
            const connection = await fetchOwnConnection(userId, spaceId, device.deviceId);
            if (connection) {
              await deleteConnection(connection.id);
            }
            setHasConnection(false);
            setStatus(null);
          })();
        },
      },
    ]);
  };

  if (!spaceId || membershipsQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!isMemoryRole(role)) {
    return (
      <Screen withHeader testID="screen-memories">
        <Title>{copy.memories.title}</Title>
        <BodyDenied />
      </Screen>
    );
  }

  return (
    <Screen
      withHeader
      testID="screen-memories"
      accessibilityLabel={copy.memories.title}
      refreshing={memoriesQuery.isRefetching}
      onRefresh={onRefresh}
    >
      <Title>{copy.memories.title}</Title>
      {status ? <Muted testID="library-status">{status}</Muted> : null}
      <Button label={copy.memories.addPhotos} onPress={() => router.push(routes.memoriesAdd)} />
      {hasConnection ? (
        <>
          <Button
            label={paused ? copy.memories.resume : copy.memories.pause}
            variant="secondary"
            onPress={() => void onPauseToggle()}
          />
          <Button
            label={copy.memories.changeSettings}
            variant="secondary"
            onPress={() => router.push(routes.memoriesConnectSettings)}
          />
          <Button label={copy.memories.disconnect} variant="secondary" onPress={onDisconnect} />
        </>
      ) : (
        <Button
          label={copy.memories.connectPhotos}
          variant="secondary"
          onPress={() => router.push(routes.memoriesConnect)}
        />
      )}
      {memoriesQuery.isLoading ? <LoadingState message={copy.common.loading} /> : null}
      {memoriesQuery.isError ? <ErrorState message={copy.common.error} /> : null}
      {!memoriesQuery.isLoading && (memoriesQuery.data ?? []).length === 0 ? (
        <EmptyState message={copy.memories.empty} />
      ) : null}
      <View style={styles.grid}>
        {(memoriesQuery.data ?? []).map((item) => (
          <Pressable
            key={item.id}
            testID={`memory-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.circleName}, ${item.uploaderName}, ${formatTakenAt(item.takenAt)}`}
            onPress={() => router.push(routes.memoryItem(item.id))}
            style={styles.tile}
          >
            {item.thumbUrl ? (
              <Image source={{ uri: item.thumbUrl }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]} />
            )}
            {item.kind === 'video' ? (
              <AppText testID={`memory-play-${item.id}`} style={styles.play}>
                {`${copy.memories.play} ${formatDuration(item.durationSeconds)}`}
              </AppText>
            ) : null}
            <AppText testID={`memory-badge-${item.id}`} style={styles.badge}>
              {item.circleName}
            </AppText>
            {item.addedAutomatically ? (
              <Muted testID={`memory-auto-${item.id}`}>{copy.memories.addedAutomatically}</Muted>
            ) : null}
            {item.caption ? <Muted testID={`memory-caption-${item.id}`}>{item.caption}</Muted> : null}
            <Muted testID={`memory-uploader-${item.id}`}>{item.uploaderName}</Muted>
            <Muted testID={`memory-meta-${item.id}`}>{formatTakenAt(item.takenAt)}</Muted>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

function BodyDenied() {
  return <Muted>{copy.memories.denied}</Muted>;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    width: '47%',
    flexGrow: 1,
    gap: spacing.xs,
  },
  thumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: colors.chip,
  },
  thumbEmpty: {
    minHeight: 96,
  },
  play: {
    ...type.caption,
    color: colors.text,
  },
  badge: {
    ...type.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
