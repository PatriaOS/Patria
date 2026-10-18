import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import { colors, spacing, type } from '../../theme';
import { moveNeedsConfirm } from './circleAudience';
import {
  deleteMemoryItem,
  fetchCircleMemberIds,
  fetchMemoryItem,
  fetchUploaderCircles,
  moveMemoryItem,
} from './memoryApi';

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

function MemoryVideo({ uri, width, height }: { uri: string; width: number; height: number }) {
  // Loaded only when a video is on screen, so Welcome is not tied to ExpoVideo.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const video = require('expo-video') as typeof import('expo-video');
  const player = video.useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });
  return (
    <View testID="memory-video" accessibilityLabel={copy.memories.play}>
      <video.VideoView
        player={player}
        style={[styles.photo, { aspectRatio: width / Math.max(1, height) }]}
        nativeControls
        contentFit="contain"
        accessibilityLabel={copy.memories.play}
      />
    </View>
  );
}

export function MemoryItemScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ itemId?: string }>();
  const itemId = typeof params.itemId === 'string' ? params.itemId : '';
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const itemQuery = useQuery({
    queryKey: ['memory-item', itemId],
    enabled: itemId.length > 0,
    queryFn: () => fetchMemoryItem(itemId),
  });
  const circlesQuery = useQuery({
    queryKey: ['memory-circles', spaceId, userId],
    enabled: Boolean(spaceId) && Boolean(userId),
    queryFn: () => fetchUploaderCircles(spaceId as string, userId as string),
  });

  const item = itemQuery.data;
  const isUploader = Boolean(item && userId && item.uploaderId === userId);

  const applyMove = async (circleId: string) => {
    if (!item) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await moveMemoryItem(item.id, circleId);
      await itemQuery.refetch();
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.memories.moveFailed);
    } finally {
      setBusy(false);
    }
  };

  const onMove = (circleId: string, circleName: string) => {
    if (!item || circleId === item.circleId || busy) {
      return;
    }
    void (async () => {
      const [currentMembers, nextMembers] = await Promise.all([
        fetchCircleMemberIds(item.circleId),
        fetchCircleMemberIds(circleId),
      ]);
      if (!moveNeedsConfirm(currentMembers, nextMembers)) {
        await applyMove(circleId);
        return;
      }
      Alert.alert(
        copy.memories.widenTitle,
        copy.memories.widenBody.replace('{circle}', circleName),
        [
          { text: copy.common.cancel, style: 'cancel' },
          {
            text: copy.memories.widenConfirm,
            onPress: () => {
              void applyMove(circleId);
            },
          },
        ],
      );
    })();
  };

  const onDelete = () => {
    if (!item) {
      return;
    }
    Alert.alert(copy.memories.delete, copy.memories.deleteConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.memories.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await deleteMemoryItem({
                id: item.id,
                fullPath: item.fullPath,
                thumbPath: item.thumbPath,
              });
              router.replace('/(signed-in)/memories');
            } catch (caught) {
              logFailedAction(caught);
              setError(copy.memories.deleteFailed);
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  if (itemQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen withHeader testID="screen-memory-item">
        <ErrorState message={copy.common.empty} />
      </Screen>
    );
  }

  return (
    <Screen
      withHeader
      testID="screen-memory-item"
      accessibilityLabel={item.caption ?? copy.memories.title}
    >
      {item.kind === 'video' && item.fullUrl ? (
        <MemoryVideo uri={item.fullUrl} width={item.width} height={item.height} />
      ) : item.fullUrl ? (
        <Image
          source={{ uri: item.fullUrl }}
          style={[styles.photo, { aspectRatio: item.width / Math.max(1, item.height) }]}
          contentFit="contain"
        />
      ) : null}
      {item.caption ? <Title>{item.caption}</Title> : null}
      {item.addedAutomatically ? <Muted>{copy.memories.addedAutomatically}</Muted> : null}
      <AppText testID="memory-item-badge" style={styles.badge}>
        {item.circleName}
      </AppText>
      <Muted testID="memory-item-date">{formatTakenAt(item.takenAt)}</Muted>
      <Muted>{item.kind === 'video' ? copy.memories.noLocationVideo : copy.memories.noLocation}</Muted>
      {error ? <ErrorState message={error} /> : null}
      {isUploader ? (
        <>
          <Muted>{copy.memories.move}</Muted>
          <View style={styles.chips}>
            {(circlesQuery.data ?? []).map((circle) => (
              <Pressable
                key={circle.id}
                testID={`move-circle-${circle.kind}`}
                accessibilityRole="button"
                accessibilityLabel={`${copy.memories.move} ${circle.name}`}
                onPress={() => onMove(circle.id, circle.name)}
                style={[styles.chip, circle.id === item.circleId && styles.chipOn]}
              >
                <AppText style={[styles.chipText, circle.id === item.circleId && styles.chipTextOn]}>
                  {circle.name}
                </AppText>
              </Pressable>
            ))}
          </View>
          <Button
            label={copy.memories.delete}
            variant="danger"
            busy={busy}
            onPress={onDelete}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    backgroundColor: colors.chip,
    borderRadius: 16,
  },
  badge: {
    ...type.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.chip,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    ...type.caption,
    color: colors.text,
  },
  chipTextOn: {
    color: colors.onPrimary,
  },
});
