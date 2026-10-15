import { describe, expect, it } from 'vitest';
import { formatDailyHours, formatShortDate } from './format';
import { addDays, buildWeeks, percentAlong, todayIso, weekStart, weeklyHours } from './schedule';

describe('formatDailyHours', () => {
  it.each([
    [40, '8 h'],
    [16, '3 h 12 min'],
    [10, '2 h'],
    [7.5, '1 h 30 min'],
    [2, '24 min'],
    [0, '0 min'],
  ])('%s h/week is %s a day', (weekly, daily) => {
    expect(formatDailyHours(weekly)).toBe(daily);
  });
});

describe('schedule dates', () => {
  it('finds the Monday of any day, across month ends', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12'); // Thursday
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday
  });

  it('builds working weeks from the current one', () => {
    const weeks = buildWeeks('2026-10-15', 3);
    expect(weeks).toEqual([
      { start: '2026-10-12', end: '2026-10-16' },
      { start: '2026-10-19', end: '2026-10-23' },
      { start: '2026-10-26', end: '2026-10-30' },
    ]);
  });

  it('places dates along the window and clamps outside it', () => {
    expect(percentAlong('2026-10-12', '2026-10-12', 84)).toBe(0);
    expect(percentAlong('2026-11-23', '2026-10-12', 84)).toBe(50);
    expect(percentAlong('2026-01-01', '2026-10-12', 84)).toBe(0);
    expect(percentAlong('2027-06-01', '2026-10-12', 84)).toBe(100);
  });

  it('formats short dates and today without timezone shifts', () => {
    expect(formatShortDate('2026-11-02')).toBe('Nov 2');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(todayIso(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });
});

describe('weeklyHours', () => {
  const weeks = buildWeeks('2026-10-12', 4);

  it('adds up confirmed and pending hours for the weeks each project runs', () => {
    const schedule = [
      // Whole window, 16 h confirmed with an increase to 20 h awaiting approval.
      { start_date: '2026-10-01', predicted_end_date: '2026-12-31', hours_per_week: 16, pending_hours: 20 },
      // Only the second week; a new assignment awaiting approval.
      { start_date: '2026-10-21', predicted_end_date: '2026-10-21', hours_per_week: null, pending_hours: 8 },
      // Starts on the Saturday after week 3, so it first counts in week 4.
      { start_date: '2026-10-31', predicted_end_date: '2026-11-30', hours_per_week: 10, pending_hours: null },
    ];
    expect(weeklyHours(schedule, weeks).map(({ confirmed, pending }) => [confirmed, pending])).toEqual([
      [16, 4],
      [16, 12],
      [16, 4],
      [26, 4],
    ]);
  });

  it('is zero everywhere without projects', () => {
    expect(weeklyHours([], weeks).every((w) => w.confirmed === 0 && w.pending === 0)).toBe(true);
  });
});
