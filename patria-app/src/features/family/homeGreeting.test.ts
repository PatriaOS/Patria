import { copy } from '../../lib/copy';
import { greetingPart, homeDateOverline, homeFamilyLine, homeGreeting } from './homeGreeting';

describe('homeGreeting', () => {
  it('is time of day aware', () => {
    expect(homeGreeting(new Date('2026-10-18T08:00:00'))).toBe(copy.home.greetingMorning);
    expect(homeGreeting(new Date('2026-10-18T14:00:00'))).toBe(copy.home.greetingAfternoon);
    expect(homeGreeting(new Date('2026-10-18T19:00:00'))).toBe(copy.home.greetingEvening);
    expect(greetingPart(new Date('2026-10-18T11:59:00'))).toBe('morning');
    expect(greetingPart(new Date('2026-10-18T12:00:00'))).toBe('afternoon');
    expect(greetingPart(new Date('2026-10-18T17:00:00'))).toBe('evening');
  });

  it('formats an overline date', () => {
    expect(homeDateOverline(new Date('2026-10-18T19:00:00'))).toMatch(/october 18/i);
  });

  it('adds The only when missing, without changing casing', () => {
    expect(homeFamilyLine('E2E Family')).toBe('The E2E Family');
    expect(homeFamilyLine('Rivera Family')).toBe('The Rivera Family');
    expect(homeFamilyLine('The Rivera Family')).toBe('The Rivera Family');
    expect(homeFamilyLine('the rivera family')).toBe('the rivera family');
    expect(homeFamilyLine('THE Olaleyes')).toBe('THE Olaleyes');
    expect(homeFamilyLine('')).toBe('');
  });
});
