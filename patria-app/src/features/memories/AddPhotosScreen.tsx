import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  ErrorState,
  Field,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { describeCaughtError, logFailedAction } from '../../lib/devLog';
import { testIdFromLabel } from '../../lib/testId';
import { colors, spacing, type } from '../../theme';
import { circleExplanation, defaultMemoryCircleId } from './circleAudience';
import { fetchUploaderCircles, uploadPreparedPhoto, uploadPreparedVideo } from './memoryApi';
import { pickMedia, type PickedMedia } from './pickMedia';
import { preparePhoto } from './preparePhoto';
import { prepareVideo } from './prepareVideo';
import { shareItemMessage, shareSkipSummary } from './shareMessages';
import { sourceHashForPick } from './sourceHash';
import { getOrCreateSourceKey } from './sourceKey';

export function AddPhotosScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedMedia[] | null>(null);
  const [circleId, setCircleId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  useEffect(() => {
    let alive = true;
    void pickMedia()
      .then((result) => {
        if (!alive) {
          return;
        }
        if (result === 'cancelled' || result.length === 0) {
          router.back();
          return;
        }
        setPicked(result);
      })
      .catch((error) => {
        logFailedAction(error);
        if (alive) {
          setFormError(copy.memories.pickFailed);
        }
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const circlesQuery = useQuery({
    queryKey: ['memory-circles', spaceId, userId],
    enabled: Boolean(spaceId) && Boolean(userId),
    queryFn: () => fetchUploaderCircles(spaceId as string, userId as string),
  });

  const circles = useMemo(() => {
    const rows = circlesQuery.data ?? [];
    return [...rows].sort((a, b) => {
      if (a.kind === 'only_me') {
        return 1;
      }
      if (b.kind === 'only_me') {
        return -1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [circlesQuery.data]);

  const selectedId = circleId ?? defaultMemoryCircleId(circles);
  const selected = circles.find((item) => item.id === selectedId);

  const onShare = async () => {
    if (!spaceId || !userId || !selectedId || !picked || picked.length === 0) {
      return;
    }
    setFormError(null);
    setBusy(true);
    setProgress(copy.memories.sharing);
    let done = 0;
    let ok = 0;
    const skips: unknown[] = [];
    try {
      const secret = await getOrCreateSourceKey(userId);
      const trimmed = caption.trim();
      for (const item of picked) {
        try {
          if (item.mediaType === 'video') {
            const prepared = await prepareVideo({
              uri: item.uri,
              width: item.width,
              height: item.height,
              durationSeconds: item.durationSeconds,
              mimeType: item.mimeType,
            });
            const sourceHash = sourceHashForPick({
              secret,
              assetId: item.assetId,
              originalBytes: prepared.fullBytes,
            });
            await uploadPreparedVideo({
              spaceId,
              circleId: selectedId,
              uploaderId: userId,
              caption: trimmed.length > 0 ? trimmed : null,
              takenAt: prepared.takenAt,
              width: prepared.width,
              height: prepared.height,
              fullUri: prepared.fullUri,
              thumbUri: prepared.thumbUri,
              durationSeconds: prepared.durationSeconds,
              fullContentType: prepared.contentType,
              sourceHash,
            });
          } else {
            const prepared = await preparePhoto(item);
            const sourceHash = sourceHashForPick({
              secret,
              assetId: item.assetId,
              originalBytes: prepared.originalBytes,
            });
            await uploadPreparedPhoto({
              spaceId,
              circleId: selectedId,
              uploaderId: userId,
              caption: trimmed.length > 0 ? trimmed : null,
              takenAt: prepared.takenAt,
              width: prepared.width,
              height: prepared.height,
              fullUri: prepared.fullUri,
              thumbUri: prepared.thumbUri,
              sourceHash,
              source: 'picker',
            });
          }
          ok += 1;
        } catch (error) {
          logFailedAction(error);
          skips.push(error);
        }
        done += 1;
        setProgress(
          copy.memories.sharingProgress
            .replace('{done}', String(done))
            .replace('{total}', String(picked.length)),
        );
      }
      if (skips.length > 0) {
        setFormError(shareSkipSummary(skips) || shareItemMessage(skips[0]));
        return;
      }
      router.replace('/(signed-in)/memories');
    } catch (error) {
      logFailedAction(error);
      const detail = describeCaughtError(error);
      setFormError(
        process.env.EXPO_PUBLIC_E2E === '1' && detail.message
          ? `${copy.memories.shareFailed} ${detail.code}: ${detail.message}`
          : copy.memories.shareFailed,
      );
    } finally {
      setBusy(false);
      if (ok === 0 || skips.length > 0) {
        setProgress(null);
      }
    }
  };

  if (!spaceId || circlesQuery.isLoading || picked === null) {
    return (
      <Screen withHeader testID="screen-memories-add">
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  return (
    <Screen
      withHeader
      keyboardAware
      testID="screen-memories-add"
      accessibilityLabel={copy.memories.addPhotos}
    >
      <Title>{copy.memories.addPhotos}</Title>
      <Muted testID="picked-count">
        {copy.memories.pickedCount.replace('{count}', String(picked.length))}
      </Muted>
      <Muted>{copy.invite.circleLabel}</Muted>
      <View style={styles.chips}>
        {circles.map((circle) => {
          const on = circle.id === selectedId;
          return (
            <Pressable
              key={circle.id}
              testID={`circle-${circle.kind}${on ? '-selected' : ''}`}
              accessibilityRole="button"
              accessibilityLabel={circle.name}
              accessibilityState={{ selected: on }}
              onPress={() => setCircleId(circle.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <AppText style={[styles.chipText, on && styles.chipTextOn]}>{circle.name}</AppText>
            </Pressable>
          );
        })}
      </View>
      {selected ? (
        <Muted testID="circle-explanation">{circleExplanation(selected.kind)}</Muted>
      ) : null}
      <Field
        label={copy.memories.captionLabel}
        placeholder={copy.memories.captionPlaceholder}
        value={caption}
        onChangeText={setCaption}
        testID={testIdFromLabel(copy.memories.captionLabel)}
      />
      {progress ? <Muted testID="memories-progress">{progress}</Muted> : null}
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.memories.share}
        testID="share"
        onPress={() => void onShare()}
        busy={busy}
        disabled={!selectedId}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
