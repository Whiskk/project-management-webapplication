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

/** Format hours without trailing zeros: 7.5 -> "7.5 h", 40 -> "40 h". */
export function formatHours(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
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
