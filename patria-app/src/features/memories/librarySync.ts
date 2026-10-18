import { Platform } from 'react-native';

import { copy } from '../../lib/copy';
import {
  fetchOwnConnection,
  fetchOwnHashes,
  fetchOwnTombstones,
  librarySyncSupported,
  patchConnection,
  type LibraryConnectionRow,
} from './libraryApi';
import { readAlbumIds } from './libraryAlbums';
import { fetchCircleMemberIds, fetchUploaderCircles, uploadPreparedPhoto } from './memoryApi';
import { preparePhoto } from './preparePhoto';
import { getOrCreateSourceKey } from './sourceKey';
import { sourceHashFromAssetId } from './sourceHash';
import {
  filterWaiting,
  needsFirstShareConfirm,
  shouldUploadNow,
  startChoiceFromStartedAt,
  type WaitingItem,
} from './syncQueue';

export type SyncProgress = {
  status: string;
  waiting: number;
};

function mediaLibrary(): typeof import('expo-media-library/legacy') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-media-library/legacy');
}

function networkModule(): typeof import('expo-network') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-network');
}

async function listWaiting(
  startedAt: string,
  mode: 'all_new' | 'selected_albums',
  albumIds: string[],
): Promise<WaitingItem[]> {
  const MediaLibrary = mediaLibrary();
  const createdAfter = new Date(startedAt).getTime();
  const albums = mode === 'selected_albums' ? albumIds : [undefined];
  const items: WaitingItem[] = [];
  for (const album of albums) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      createdAfter,
      first: 100,
      sortBy: [MediaLibrary.SortBy.creationTime],
      ...(album ? { album } : {}),
    });
    for (const asset of page.assets) {
      items.push({
        assetId: asset.id,
        createdAt: asset.creationTime,
        albumId: album ?? null,
      });
    }
  }
  return items;
}

export async function runLibrarySync(input: {
  userId: string;
  spaceId: string;
  deviceId: string;
  confirm?: (count: number, circleName: string) => Promise<boolean>;
  onProgress?: (progress: SyncProgress) => void;
}): Promise<void> {
  if (!librarySyncSupported() || Platform.OS !== 'ios') {
    return;
  }
  const connection = await fetchOwnConnection(input.userId, input.spaceId, input.deviceId);
  if (!connection) {
    return;
  }
  const members = await fetchCircleMemberIds(connection.circle_id);
  if (!members.includes(input.userId)) {
    await patchConnection(connection.id, { paused: true, needs_circle: true });
    input.onProgress?.({ status: copy.memories.statusChooseCircle, waiting: 0 });
    return;
  }
  const Network = networkModule();
  const net = await Network.getNetworkStateAsync();
  const wifi = net.type === Network.NetworkStateType.WIFI;
  if (!shouldUploadNow({ paused: connection.paused, onWifi: wifi, allowCellular: connection.allow_cellular })) {
    const status = connection.paused
      ? copy.memories.statusPaused
      : copy.memories.statusWifi;
    input.onProgress?.({ status, waiting: 0 });
    return;
  }
  const secret = await getOrCreateSourceKey(input.userId);
  const [hashes, tombs, albumIds] = await Promise.all([
    fetchOwnHashes(input.userId, input.spaceId),
    fetchOwnTombstones(input.userId, input.spaceId),
    readAlbumIds(input.userId, input.spaceId),
  ]);
  const items = await listWaiting(connection.started_at, connection.mode, albumIds);
  const waiting = filterWaiting({
    items,
    startedAt: connection.started_at,
    mode: connection.mode,
    albumIds,
    knownHashes: new Set(hashes),
    tombstones: new Set(tombs),
    hashForAsset: (assetId) => sourceHashFromAssetId(secret, assetId),
  });
  input.onProgress?.({
    status: waiting.length > 0 ? copy.memories.statusSharing.replace('{count}', String(waiting.length)) : copy.memories.statusUpToDate,
    waiting: waiting.length,
  });
  if (waiting.length === 0) {
    await patchConnection(connection.id, { last_synced_at: new Date().toISOString() });
    return;
  }
  const startChoice = startChoiceFromStartedAt(connection.started_at);
  if (
    !connection.last_synced_at &&
    needsFirstShareConfirm({ startChoice, waitingCount: waiting.length }) &&
    input.confirm
  ) {
    const circles = await fetchUploaderCircles(input.spaceId, input.userId);
    const circleName = circles.find((circle) => circle.id === connection.circle_id)?.name ?? '';
    const ok = await input.confirm(waiting.length, circleName);
    if (!ok) {
      await patchConnection(connection.id, { paused: true });
      return;
    }
  }
  await shareAssets(waiting, connection, input, secret);
}

async function shareAssets(
  waiting: WaitingItem[],
  connection: LibraryConnectionRow,
  input: { userId: string; spaceId: string },
  secret: Uint8Array,
): Promise<void> {
  const MediaLibrary = mediaLibrary();
  for (const item of waiting) {
    const info = await MediaLibrary.getAssetInfoAsync(item.assetId);
    const uri = info.localUri ?? info.uri;
    if (!uri) {
      continue;
    }
    const prepared = await preparePhoto({
      uri,
      width: info.width,
      height: info.height,
      exif: null,
    });
    const hash = sourceHashFromAssetId(secret, item.assetId);
    try {
      await uploadPreparedPhoto({
        spaceId: input.spaceId,
        circleId: connection.circle_id,
        uploaderId: input.userId,
        caption: null,
        takenAt: new Date(item.createdAt).toISOString(),
        width: prepared.width,
        height: prepared.height,
        fullUri: prepared.fullUri,
        thumbUri: prepared.thumbUri,
        sourceHash: hash,
        source: 'library_sync',
        addedAutomatically: true,
      });
    } catch {
      // One failure does not stop the rest.
    }
  }
  await patchConnection(connection.id, { last_synced_at: new Date().toISOString() });
}
