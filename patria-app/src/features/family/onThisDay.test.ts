import { zonedTimeToUtc } from '../sync/syncSchedule';
import type { MemoryItem } from '../memories/memoryApi';
import { pickOnThisDay, yearsAgoLabel } from './onThisDay';

function memory(id: string, takenAt: Date): MemoryItem {
  return {
    id,
    familySpaceId: 's1',
    circleId: 'c1',
    circleName: 'Household',
    circleKind: 'household',
    uploaderId: 'u1',
    uploaderName: 'Ana',
    caption: null,
    takenAt: takenAt.toISOString(),
    createdAt: takenAt.toISOString(),
    width: 1,
    height: 1,
    fullPath: 'f',
    thumbPath: 't',
    thumbUrl: null,
    fullUrl: null,
    kind: 'photo',
    durationSeconds: null,
    addedAutomatically: false,
    sourceHash: null,
  };
}

describe('pickOnThisDay', () => {
  const zone = 'America/Chicago';
  const now = zonedTimeToUtc(zone, 2026, 10, 25, 10, 0);

  it('matches month and day from an earlier year', () => {
    const pick = pickOnThisDay([memory('a', zonedTimeToUtc(zone, 2024, 10, 25, 15, 0))], zone, now);
    expect(pick?.item.id).toBe('a');
    expect(pick?.yearsAgo).toBe(2);
  });

  it('ignores this year, other days and an empty library', () => {
    expect(pickOnThisDay([], zone, now)).toBeNull();
    expect(
      pickOnThisDay(
        [
          memory('same-year', zonedTimeToUtc(zone, 2026, 10, 25, 8, 0)),
          memory('other-day', zonedTimeToUtc(zone, 2024, 10, 24, 15, 0)),
        ],
        zone,
        now,
      ),
    ).toBeNull();
  });

  it('judges the date in the family time zone, not UTC', () => {
    // 2024-10-26 02:00 UTC is still 25 October evening in Chicago.
    const lateEvening = new Date('2024-10-26T02:00:00.000Z');
    expect(pickOnThisDay([memory('late', lateEvening)], zone, now)?.item.id).toBe('late');
    // Same instant is 26 October in UTC, so it does not match on a UTC calendar.
    expect(pickOnThisDay([memory('late', lateEvening)], 'UTC', now)).toBeNull();
  });

  it('prefers the oldest year when several match', () => {
    const pick = pickOnThisDay(
      [
        memory('recent', zonedTimeToUtc(zone, 2025, 10, 25, 9, 0)),
        memory('oldest', zonedTimeToUtc(zone, 2021, 10, 25, 9, 0)),
      ],
      zone,
      now,
    );
    expect(pick?.item.id).toBe('oldest');
    expect(pick?.yearsAgo).toBe(5);
  });
});

describe('yearsAgoLabel', () => {
  it('uses singular for one year', () => {
    expect(yearsAgoLabel(1)).toBe('1 year ago');
    expect(yearsAgoLabel(3)).toBe('3 years ago');
  });
});
