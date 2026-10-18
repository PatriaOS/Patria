import {
  filterWaiting,
  needsFirstShareConfirm,
  nextSyncStatus,
  shouldUploadNow,
  startChoiceFromStartedAt,
  startedAtForChoice,
} from './syncQueue';

describe('library sync queue', () => {
  const connection = {
    id: 'c1',
    circleId: 'hh',
    startedAt: new Date().toISOString(),
    allowCellular: false,
    paused: false,
    needsCircle: false,
    mode: 'all_new' as const,
  };

  it('waits for WiFi unless cellular is on, and pause stops uploads', () => {
    expect(shouldUploadNow({ paused: false, onWifi: false, allowCellular: false })).toBe(false);
    expect(shouldUploadNow({ paused: false, onWifi: false, allowCellular: true })).toBe(true);
    expect(shouldUploadNow({ paused: true, onWifi: true, allowCellular: true })).toBe(false);
    expect(nextSyncStatus({ connection, onWifi: false, waitingCount: 1 })).toBe('waiting_wifi');
    expect(
      nextSyncStatus({
        connection: { ...connection, paused: true },
        onWifi: true,
        waitingCount: 1,
      }),
    ).toBe('paused');
    expect(nextSyncStatus({ connection, onWifi: true, waitingCount: 2 })).toBe('sharing');
    expect(nextSyncStatus({ connection, onWifi: true, waitingCount: 0 })).toBe('up_to_date');
  });

  it('asks before sharing last 30 days or more than 20 items', () => {
    expect(needsFirstShareConfirm({ startChoice: 'today', waitingCount: 3 })).toBe(false);
    expect(needsFirstShareConfirm({ startChoice: 'today', waitingCount: 21 })).toBe(true);
    expect(needsFirstShareConfirm({ startChoice: 'last_30_days', waitingCount: 2 })).toBe(true);
  });

  it('starts From today at local midnight', () => {
    const now = new Date('2026-10-17T15:04:00');
    const today = startedAtForChoice('today', now);
    expect(today.getHours()).toBe(0);
    expect(startedAtForChoice('last_30_days', now).getTime()).toBeLessThan(now.getTime());
  });

  it('skips older items, other albums, known hashes and tombstones', () => {
    const start = new Date('2026-10-17T00:00:00Z');
    const items = [
      { assetId: 'old', createdAt: start.getTime() - 1000, albumId: 'kids' },
      { assetId: 'kids-new', createdAt: start.getTime() + 1000, albumId: 'kids' },
      { assetId: 'other', createdAt: start.getTime() + 1000, albumId: 'other' },
      { assetId: 'tomb', createdAt: start.getTime() + 1000, albumId: 'kids' },
      { assetId: 'have', createdAt: start.getTime() + 1000, albumId: 'kids' },
    ];
    const hashes: Record<string, string> = {
      old: 'h-old',
      'kids-new': 'h-new',
      other: 'h-other',
      tomb: 'h-tomb',
      have: 'h-have',
    };
    const waiting = filterWaiting({
      items,
      startedAt: start.toISOString(),
      mode: 'selected_albums',
      albumIds: ['kids'],
      knownHashes: new Set(['h-have']),
      tombstones: new Set(['h-tomb']),
      hashForAsset: (id) => hashes[id],
    });
    expect(waiting.map((item) => item.assetId)).toEqual(['kids-new']);
  });

  it('retries only when not paused and the network is allowed', () => {
    expect(shouldUploadNow({ paused: false, onWifi: true, allowCellular: false })).toBe(true);
  });

  it('treats a start 30 days back as last 30 days for the first-share confirm', () => {
    const now = new Date('2026-10-17T15:00:00');
    expect(startChoiceFromStartedAt(startedAtForChoice('today', now).toISOString(), now)).toBe(
      'today',
    );
    expect(
      startChoiceFromStartedAt(startedAtForChoice('last_30_days', now).toISOString(), now),
    ).toBe('last_30_days');
  });
});
