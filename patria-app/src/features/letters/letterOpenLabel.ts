import { copy } from '../../lib/copy';
import { formatAgeOpenLabel, formatLetterOpenDay, ymdInZone } from './letterDates';
import type { LetterRow } from './letterApi';

/** Author/list copy for when a letter opens — age never shows a calendar date. */
export function letterOpensOnLabel(
  letter: Pick<LetterRow, 'triggerKind' | 'triggerAge' | 'triggerAt'>,
  recipientName: string,
  timeZone: string,
): string {
  if (letter.triggerKind === 'age' && letter.triggerAge != null) {
    return formatAgeOpenLabel(recipientName, letter.triggerAge);
  }
  if (letter.triggerAt) {
    return formatLetterOpenDay(ymdInZone(letter.triggerAt, timeZone), timeZone);
  }
  return '';
}

export function letterOpensOnLine(
  letter: Pick<LetterRow, 'triggerKind' | 'triggerAge' | 'triggerAt'>,
  recipientName: string,
  timeZone: string,
): string {
  const label = letterOpensOnLabel(letter, recipientName, timeZone);
  if (letter.triggerKind === 'age') {
    return copy.letters.ageOpenLine.replace('{label}', label);
  }
  return copy.letters.opensOn.replace('{date}', label);
}
