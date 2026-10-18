export type SyncStatus =
  | 'up_to_date'
  | 'sharing'
  | 'waiting_wifi'
  | 'paused'
  | 'needs_circle';

export type LibraryConnection = {
  id: string;
  circleId: string;
  startedAt: string;
  allowCellular: boolean;
  paused: boolean;
  needsCircle: boolean;
  mode: 'all_new' | 'selected_albums';
};

export type WaitingItem = {
  assetId: string;
  createdAt: number;
  albumId: string | null;
};

export function needsFirstShareConfirm(input: {
  startChoice: 'today' | 'last_30_days';
  waitingCount: number;
}): boolean {
  return input.startChoice === 'last_30_days' || input.waitingCount > 20;
}

export function startedAtForChoice(
  choice: 'today' | 'last_30_days',
  now: Date = new Date(),
): Date {
  if (choice === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

export function startChoiceFromStartedAt(
  startedAt: string,
  now: Date = new Date(),
): 'today' | 'last_30_days' {
  const todayStart = startedAtForChoice('today', now).getTime();
  return new Date(startedAt).getTime() < todayStart - 60_000 ? 'last_30_days' : 'today';
}

export function filterWaiting(input: {
  items: WaitingItem[];
  startedAt: string;
  mode: 'all_new' | 'selected_albums';
  albumIds: string[];
  knownHashes: Set<string>;
  tombstones: Set<string>;
  hashForAsset: (assetId: string) => string;
}): WaitingItem[] {
  const start = new Date(input.startedAt).getTime();
  const albums = new Set(input.albumIds);
  return input.items.filter((item) => {
    if (item.createdAt < start) {
      return false;
    }
    if (input.mode === 'selected_albums' && (!item.albumId || !albums.has(item.albumId))) {
      return false;
    }
    const hash = input.hashForAsset(item.assetId);
    if (input.knownHashes.has(hash) || input.tombstones.has(hash)) {
      return false;
    }
    return true;
  });
}

export function nextSyncStatus(input: {
  connection: LibraryConnection | null;
  onWifi: boolean;
  waitingCount: number;
}): SyncStatus {
  if (!input.connection) {
    return 'up_to_date';
  }
  if (input.connection.needsCircle) {
    return 'needs_circle';
  }
  if (input.connection.paused) {
    return 'paused';
  }
  if (!input.onWifi && !input.connection.allowCellular) {
    return 'waiting_wifi';
  }
  if (input.waitingCount > 0) {
    return 'sharing';
  }
  return 'up_to_date';
}

export function shouldUploadNow(input: {
  paused: boolean;
  onWifi: boolean;
  allowCellular: boolean;
}): boolean {
  if (input.paused) {
    return false;
  }
  return input.onWifi || input.allowCellular;
}
