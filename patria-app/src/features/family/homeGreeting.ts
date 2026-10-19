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
