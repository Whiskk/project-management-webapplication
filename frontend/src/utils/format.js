const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Format a number as whole US dollars, or an em dash when missing. */
export function formatCurrency(value) {
  return value === null || value === undefined ? '—' : currencyFormatter.format(value);
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Format an ISO date ("2026-11-02") as "Nov 2, 2026" without timezone shifts. */
export function formatDate(value) {
  return value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : '—';
}

const shortDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Format an ISO date as "Nov 2" (for timelines, where the year is clear from context). */
export function formatShortDate(value) {
  return value ? shortDateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : '—';
}

/** Format hours without trailing zeros: 7.5 -> "7.5 h", 40 -> "40 h". */
export function formatHours(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
}

/**
 * Weekly hours as time per working day (a 5-day week): 16 -> "3 h 12 min", 40 -> "8 h", 2 -> "24 min".
 * Gives people the everyday meaning of "16 h per week".
 */
export function formatDailyHours(hoursPerWeek) {
  const minutes = Math.round((Number(hoursPerWeek) * 60) / 5);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "First Last" for a user-like object. */
export function fullName(user) {
  return user ? `${user.first_name} ${user.last_name}` : '';
}

/** Field-level errors from an ApiError (validation details), excluding the general "_" key. */
export function fieldErrorsFrom(error) {
  const details = error?.code === 'validation_error' && error.details ? error.details : {};
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== '_'));
}
