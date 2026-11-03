import {
  addYearsToYmd,
  formatLetterOpenDay,
  friendlyTimeZoneName,
  isAfterToday,
  isValidYmd,
  tomorrowYmd,
  triggerHasPassed,
  ymdInZone,
  zonedMidnightIso,
} from './letterDates';

describe('letterDates', () => {
  it('accepts only real calendar days', () => {
    expect(isValidYmd('2030-02-28')).toBe(true);
    expect(isValidYmd('2030-02-30')).toBe(false);
    expect(isValidYmd('2030-2-3')).toBe(false);
    expect(isValidYmd('soon')).toBe(false);
  });

  it('starts the day at midnight in the family zone, not UTC', () => {
    expect(zonedMidnightIso('2030-01-15', 'America/New_York')).toBe('2030-01-15T05:00:00.000Z');
    expect(zonedMidnightIso('2030-07-15', 'America/New_York')).toBe('2030-07-15T04:00:00.000Z');
    expect(zonedMidnightIso('2030-07-15', 'Europe/London')).toBe('2030-07-14T23:00:00.000Z');
    expect(zonedMidnightIso('2030-07-15', 'Asia/Kolkata')).toBe('2030-07-14T18:30:00.000Z');
  });

  it('lands on the right day across a daylight saving change', () => {
    // US clocks spring forward on 2030-03-10.
    expect(zonedMidnightIso('2030-03-10', 'America/Chicago')).toBe('2030-03-10T06:00:00.000Z');
    expect(zonedMidnightIso('2030-03-11', 'America/Chicago')).toBe('2030-03-11T05:00:00.000Z');
  });

  it('round trips a day through the zone', () => {
    const iso = zonedMidnightIso('2031-12-24', 'Pacific/Auckland');
    expect(ymdInZone(iso, 'Pacific/Auckland')).toBe('2031-12-24');
  });

  it('only allows days after today in the family zone', () => {
    const now = new Date('2030-01-15T03:00:00Z'); // still Jan 14 in New York
    expect(isAfterToday('2030-01-15', 'America/New_York', now)).toBe(true);
    expect(isAfterToday('2030-01-14', 'America/New_York', now)).toBe(false);
    expect(isAfterToday('2030-01-15', 'UTC', now)).toBe(false);
    expect(isAfterToday('nope', 'UTC', now)).toBe(false);
  });

  it('adds years and keeps Feb 29 valid', () => {
    expect(addYearsToYmd('2030-06-01', 5)).toBe('2035-06-01');
    expect(addYearsToYmd('2032-02-29', 1)).toBe('2033-02-28');
    expect(addYearsToYmd('2032-02-29', 4)).toBe('2036-02-29');
  });

  it('knows when the trigger has passed', () => {
    const now = new Date('2030-01-15T12:00:00Z');
    expect(triggerHasPassed('2030-01-15T12:00:00.000Z', now)).toBe(true);
    expect(triggerHasPassed('2030-01-15T12:00:01.000Z', now)).toBe(false);
  });

  it('formats the open day with a weekday', () => {
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/Tuesday/);
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/November/);
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/2027/);
  });

  it('names the family zone in plain words', () => {
    expect(friendlyTimeZoneName('America/Chicago', new Date('2027-07-01T12:00:00Z'))).toMatch(
      /Central/i,
    );
  });

  it('picks tomorrow in the family zone', () => {
    const now = new Date('2030-01-15T03:00:00Z'); // still Jan 14 in New York
    expect(tomorrowYmd('America/New_York', now)).toBe('2030-01-15');
  });
});
