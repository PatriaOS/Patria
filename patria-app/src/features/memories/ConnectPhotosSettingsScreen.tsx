import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  Body,
  Button,
  ChoiceChip,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Section,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { space } from '../../theme/tokens';
import { circleExplanation } from './circleAudience';
import { canTurnOnSharing } from './connectSettings';
import { writeAlbumIds } from './libraryAlbums';
import { upsertConnection, type LibraryMode } from './libraryApi';
import { fetchUploaderCircles } from './memoryApi';
import { startedAtForChoice } from './syncQueue';

type Access = 'all' | 'limited' | 'none';

export function ConnectPhotosSettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const whoY = useRef(0);
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

  const ready = canTurnOnSharing({ mode, circleId, albumIds });

  const onTurnOn = async () => {
    if (!circleId) {
      setError(copy.memories.chooseCircleFirst);
      scrollRef.current?.scrollTo({ y: Math.max(0, whoY.current - space.md), animated: true });
      return;
    }
    if (!ready || !spaceId || !userId) {
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
      scrollRef={scrollRef}
      testID="screen-memories-connect-settings"
      accessibilityLabel={copy.memories.connectTitle}
    >
      <Title>{copy.memories.connectTitle}</Title>
      {access === 'all' ? (
        <Muted testID="photo-access-full">{copy.memories.photoAccessFull}</Muted>
      ) : null}
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
      {access === 'none' ? (
        <Muted testID="photo-access-denied">{copy.memories.photoAccessDenied}</Muted>
      ) : null}
      {access !== 'all' ? (
        <Button
          label={copy.memories.openSettings}
          testID="open-settings"
          variant="secondary"
          onPress={() => {
            void Linking.openSettings();
          }}
        />
      ) : null}

      <View testID="step-what">
        <Section>{copy.memories.stepWhat}</Section>
      </View>
      <View style={styles.chips}>
        <ChoiceChip
          label={copy.memories.modeAll}
          selected={mode === 'all_new'}
          onPress={() => setMode('all_new')}
          testID="mode-all"
        />
        <ChoiceChip
          label={copy.memories.modeAlbums}
          selected={mode === 'selected_albums'}
          onPress={() => {
            if (access !== 'all') {
              return;
            }
            setMode('selected_albums');
          }}
          testID="mode-albums"
        />
      </View>
      <Muted testID="mode-faces">
        {copy.memories.modeFaces}. {copy.memories.modeFacesLater}
      </Muted>
      {access !== 'all' ? <Muted testID="albums-need-full">{copy.memories.albumsNeedFull}</Muted> : null}
      {mode === 'selected_albums' && access === 'all'
        ? albums.map((album) => {
            const on = albumIds.includes(album.id);
            return (
              <ChoiceChip
                key={album.id}
                label={album.title}
                selected={on}
                onPress={() =>
                  setAlbumIds((current) =>
                    on ? current.filter((id) => id !== album.id) : [...current, album.id],
                  )
                }
              />
            );
          })
        : null}

      <View
        testID="step-who"
        onLayout={(event) => {
          whoY.current = event.nativeEvent.layout.y;
        }}
      >
        <Section>{copy.memories.stepWho}</Section>
      </View>
      <View style={styles.chips}>
        {(circlesQuery.data ?? []).map((circle) => {
          const on = circle.id === circleId;
          return (
            <ChoiceChip
              key={circle.id}
              testID={`connect-circle-${circle.kind}${on ? '-selected' : ''}`}
              label={circle.name}
              selected={on}
              onPress={() => {
                setCircleId(circle.id);
                setError(null);
              }}
            />
          );
        })}
      </View>
      {selected ? (
        <Muted>{circleExplanation(selected.kind)}</Muted>
      ) : (
        <Muted testID="choose-who">{copy.memories.chooseCircleFirst}</Muted>
      )}

      <View testID="step-start">
        <Section>{copy.memories.stepStart}</Section>
      </View>
      <View style={styles.chips}>
        <ChoiceChip
          label={copy.memories.startToday}
          selected={startChoice === 'today'}
          onPress={() => setStartChoice('today')}
          testID="start-today"
        />
        <ChoiceChip
          label={copy.memories.startMonth}
          selected={startChoice === 'last_30_days'}
          onPress={() => setStartChoice('last_30_days')}
          testID="start-month"
        />
      </View>

      <View testID="step-network">
        <Section>{copy.memories.stepNetwork}</Section>
      </View>
      <View style={styles.row}>
        <Body>{copy.memories.useCellular}</Body>
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
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});
