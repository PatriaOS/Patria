import {
  addYearsToYmd,
  ageOrdinal,
  birthdayYmdAtAge,
  formatAgeOpenLabel,
  formatLetterOpenDay,
  friendlyTimeZoneName,
  isAfterToday,
  isValidYmd,
  pickerDateToYmd,
  tomorrowYmd,
  triggerHasPassed,
  ymdInZone,
  ymdToPickerDate,
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

  it('computes Nth birthday with Feb 29 → Mar 1 in non-leap years', () => {
    expect(birthdayYmdAtAge('2000-06-15', 18)).toBe('2018-06-15');
    expect(birthdayYmdAtAge('2000-02-29', 1)).toBe('2001-03-01');
    expect(birthdayYmdAtAge('2000-02-29', 4)).toBe('2004-02-29');
    expect(zonedMidnightIso(birthdayYmdAtAge('2000-02-29', 1), 'America/Chicago')).toBe(
      '2001-03-01T06:00:00.000Z',
    );
  });

  it('formats age open copy without a calendar date', () => {
    expect(ageOrdinal(1)).toBe('1st');
    expect(ageOrdinal(2)).toBe('2nd');
    expect(ageOrdinal(3)).toBe('3rd');
    expect(ageOrdinal(11)).toBe('11th');
    expect(ageOrdinal(18)).toBe('18th');
    expect(formatAgeOpenLabel('Test 2', 18)).toBe("Test 2's 18th birthday");
  });

  it('knows when the trigger has passed', () => {
    const now = new Date('2030-01-15T12:00:00Z');
    expect(triggerHasPassed('2030-01-15T12:00:00.000Z', now)).toBe(true);
    expect(triggerHasPassed('2030-01-15T12:00:01.000Z', now)).toBe(false);
  });

  it('formats the open day with a weekday in the device locale', () => {
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/Tuesday/);
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/November/);
    expect(formatLetterOpenDay('2027-11-02', 'America/Chicago')).toMatch(/2027/);
  });

  it('maps picker dates by device-local calendar so the wheel matches the label', () => {
    const ymd = '2027-11-05';
    const picker = ymdToPickerDate(ymd);
    expect(picker.getFullYear()).toBe(2027);
    expect(picker.getMonth()).toBe(10);
    expect(picker.getDate()).toBe(5);
    expect(pickerDateToYmd(picker)).toBe(ymd);
    // Saving still uses family-zone midnight, not the picker's local instant.
    expect(zonedMidnightIso(pickerDateToYmd(picker), 'America/Chicago')).toBe(
      '2027-11-05T05:00:00.000Z',
    );
  });

  it('names the family zone with the full friendly Time word', () => {
    expect(friendlyTimeZoneName('America/Chicago', new Date('2027-07-01T12:00:00Z'))).toBe(
      'Central Time',
    );
    expect(friendlyTimeZoneName('America/New_York', new Date('2027-01-15T12:00:00Z'))).toBe(
      'Eastern Time',
    );
    expect(friendlyTimeZoneName('America/New_York', new Date('2027-01-15T12:00:00Z'))).not.toBe(
      'Eastern',
    );
  });

  it('picks tomorrow in the family zone', () => {
    const now = new Date('2030-01-15T03:00:00Z'); // still Jan 14 in New York
    expect(tomorrowYmd('America/New_York', now)).toBe('2030-01-15');
  });
});
