import { copy } from '../../lib/copy';
import { getZonedParts } from '../sync/syncSchedule';
import type { MemoryItem } from '../memories/memoryApi';

export type OnThisDayPick = {
  item: MemoryItem;
  yearsAgo: number;
};

/**
 * A memory taken on today's month and day in an earlier year, judged in the family time zone.
 * Callers pass only memories the person may already see (the library read is limited by
 * `can_view_memory`), so nothing outside their circles can appear. With several matches the
 * oldest year wins; a 29 February memory only shows on 29 February.
 */
export function pickOnThisDay(
  items: MemoryItem[],
  timeZone: string,
  now: Date = new Date(),
): OnThisDayPick | null {
  const today = getZonedParts(now, timeZone);
  let best: OnThisDayPick | null = null;
  let bestTakenAt = '';
  for (const item of items) {
    const taken = getZonedParts(new Date(item.takenAt), timeZone);
    if (taken.month !== today.month || taken.day !== today.day || taken.year >= today.year) {
      continue;
    }
    const yearsAgo = today.year - taken.year;
    if (!best || yearsAgo > best.yearsAgo || (yearsAgo === best.yearsAgo && item.takenAt < bestTakenAt)) {
      best = { item, yearsAgo };
      bestTakenAt = item.takenAt;
    }
  }
  return best;
}

export function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1
    ? copy.home.onThisDayYearsAgoOne
    : copy.home.onThisDayYearsAgo.replace('{count}', String(yearsAgo));
}
