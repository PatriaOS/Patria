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
 * Second greeting line: "the Rivera family". If the stored name already includes
 * "family", use it as-is (e.g. "The Rivera Family"). A leading "The " is dropped
 * so we never say "the The Riveras family".
 */
export function homeFamilyLine(spaceName: string): string {
  const trimmed = spaceName.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/\bfamily\b/i.test(trimmed)) {
    return trimmed;
  }
  const core = trimmed.replace(/^the\s+/i, '');
  return `the ${core} family`;
}
