import { createContext, useContext } from 'react';

export const NotificationContext = createContext(() => {});

/**
 * Show a snackbar message: `notify('Saved', 'success')`.
 * Severity is one of 'success' | 'info' | 'warning' | 'error'.
 */
export function useNotify() {
  return useContext(NotificationContext);
}
