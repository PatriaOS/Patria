import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

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
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { colors, spacing, type } from '../../theme';
import { circleExplanation } from './circleAudience';
import { writeAlbumIds } from './libraryAlbums';
import { upsertConnection, type LibraryMode } from './libraryApi';
import { fetchUploaderCircles } from './memoryApi';
import { startedAtForChoice } from './syncQueue';

type Access = 'all' | 'limited' | 'none';

export function ConnectPhotosSettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>('none');
  const [mode, setMode] = useState<LibraryMode>('all_new');
  const [circleId, setCircleId] = useState<string | null>(null);
  const [startChoice, setStartChoice] = useState<'today' | 'last_30_days'>('today');
  const [allowCellular, setAllowCellular] = useState(false);
  const [albums, setAlbums] = useState<{ id: string; title: string }[]>([]);
  const [albumIds, setAlbumIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const circlesQuery = useQuery({
    queryKey: ['memory-circles', spaceId, userId],
    enabled: Boolean(spaceId) && Boolean(userId),
    queryFn: () => fetchUploaderCircles(spaceId as string, userId as string),
  });

  async function refreshAccess() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
    const permission = await MediaLibrary.getPermissionsAsync();
    if (permission.status !== 'granted') {
      setAccess('none');
      return;
    }
    const privileges = permission.accessPrivileges === 'limited' ? 'limited' : 'all';
    setAccess(privileges);
    if (privileges === 'all') {
      const rows = await MediaLibrary.getAlbumsAsync();
      setAlbums(rows.map((album) => ({ id: album.id, title: album.title })));
    } else {
      setAlbums([]);
      setMode('all_new');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- photo library permission is outside React
    void refreshAccess();
  }, []);

  const onTurnOn = async () => {
    if (!spaceId || !userId || !circleId) {
      setError(copy.memories.chooseCircleFirst);
      return;
    }
    if (mode === 'selected_albums' && albumIds.length === 0) {
      setError(copy.memories.chooseCircleFirst);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const device = await ensureDeviceIdentity(userId);
      await writeAlbumIds(userId, spaceId, mode === 'selected_albums' ? albumIds : []);
      await upsertConnection({
        userId,
        spaceId,
        deviceId: device.deviceId,
        mode,
        circleId,
        startedAt: startedAtForChoice(startChoice).toISOString(),
        allowCellular,
      });
      router.replace(routes.memories);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (!spaceId || circlesQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  const selected = (circlesQuery.data ?? []).find((circle) => circle.id === circleId);

  return (
    <Screen
      withHeader
      testID="screen-memories-connect-settings"
      accessibilityLabel={copy.memories.connectTitle}
    >
      <Title>{copy.memories.connectTitle}</Title>
      {access === 'limited' ? <Muted testID="limited-body">{copy.memories.limitedBody}</Muted> : null}
      {access === 'limited' ? (
        <Button
          label={copy.memories.limitedPicker}
          testID="choose-allowed-photos"
          variant="secondary"
          onPress={() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
            void MediaLibrary.presentPermissionsPickerAsync().then(() => void refreshAccess());
          }}
        />
      ) : null}
      <Button
        label={copy.memories.openSettings}
        testID="open-settings"
        variant="secondary"
        onPress={() => {
          void Linking.openSettings();
        }}
      />
      <Muted>{copy.memories.modeAll}</Muted>
      <View style={styles.chips}>
        <ModeChip
          label={copy.memories.modeAll}
          on={mode === 'all_new'}
          onPress={() => setMode('all_new')}
          testID="mode-all"
        />
        <ModeChip
          label={copy.memories.modeAlbums}
          on={mode === 'selected_albums'}
          onPress={() => {
            if (access !== 'all') {
              return;
            }
            setMode('selected_albums');
          }}
          testID="mode-albums"
        />
        <ModeChip label={copy.memories.modeFaces} on={false} onPress={() => undefined} testID="mode-faces" />
      </View>
      <Muted>{copy.memories.modeFacesLater}</Muted>
      {access !== 'all' ? <Muted testID="albums-need-full">{copy.memories.albumsNeedFull}</Muted> : null}
      {mode === 'selected_albums' && access === 'all'
        ? albums.map((album) => {
            const on = albumIds.includes(album.id);
            return (
              <Pressable
                key={album.id}
                accessibilityRole="button"
                accessibilityLabel={album.title}
                accessibilityState={{ selected: on }}
                onPress={() =>
                  setAlbumIds((current) =>
                    on ? current.filter((id) => id !== album.id) : [...current, album.id],
                  )
                }
                style={[styles.chip, on && styles.chipOn]}
              >
                <AppText style={[styles.chipText, on && styles.chipTextOn]}>{album.title}</AppText>
              </Pressable>
            );
          })
        : null}
      <Muted>{copy.memories.chooseCircle}</Muted>
      <View style={styles.chips}>
        {(circlesQuery.data ?? []).map((circle) => {
          const on = circle.id === circleId;
          return (
            <Pressable
              key={circle.id}
              testID={`connect-circle-${circle.kind}${on ? '-selected' : ''}`}
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
      {selected ? <Muted>{circleExplanation(selected.kind)}</Muted> : <Muted>{copy.memories.chooseCircleFirst}</Muted>}
      <View style={styles.chips}>
        <ModeChip
          label={copy.memories.startToday}
          on={startChoice === 'today'}
          onPress={() => setStartChoice('today')}
          testID="start-today"
        />
        <ModeChip
          label={copy.memories.startMonth}
          on={startChoice === 'last_30_days'}
          onPress={() => setStartChoice('last_30_days')}
          testID="start-month"
        />
      </View>
      <View style={styles.row}>
        <AppText>{copy.memories.useCellular}</AppText>
        <Switch
          testID="use-cellular"
          accessibilityLabel={copy.memories.useCellular}
          value={allowCellular}
          onValueChange={setAllowCellular}
        />
      </View>
      {error ? <ErrorState message={error} /> : null}
      <Button
        label={copy.memories.turnOn}
        testID="turn-on-sharing"
        onPress={() => void onTurnOn()}
        busy={busy}
        disabled={!circleId}
      />
    </Screen>
  );
}

function ModeChip(input: {
  label: string;
  on: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={input.testID}
      accessibilityRole="button"
      accessibilityLabel={input.label}
      accessibilityState={{ selected: input.on }}
      onPress={input.onPress}
      style={[styles.chip, input.on && styles.chipOn]}
    >
      <AppText style={[styles.chipText, input.on && styles.chipTextOn]}>{input.label}</AppText>
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
