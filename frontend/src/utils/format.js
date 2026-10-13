const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Format a number as whole US dollars, or an em dash when missing. */
export function formatCurrency(value) {
  return value === null || value === undefined ? '—' : currencyFormatter.format(value);
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
