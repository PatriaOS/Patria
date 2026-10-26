import { copy } from '../../lib/copy';

export type GreetingPart = 'morning' | 'afternoon' | 'evening';

export function greetingPart(now = new Date()): GreetingPart {
  const hour = now.getHours();
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

export function homeGreeting(now = new Date()): string {
  const part = greetingPart(now);
  if (part === 'morning') {
    return copy.home.greetingMorning;
  }
  if (part === 'afternoon') {
    return copy.home.greetingAfternoon;
  }
  return copy.home.greetingEvening;
}

export function homeDateOverline(now = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Family name for the Home greeting. Prepends "The " only when the stored name
 * does not already start with "The" (case insensitive). Never changes casing.
 */
export function homeFamilyLine(spaceName: string): string {
  const trimmed = spaceName.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^the\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `The ${trimmed}`;
}
