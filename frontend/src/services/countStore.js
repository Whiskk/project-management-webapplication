import { useEffect, useSyncExternalStore } from 'react';

/**
 * Create a tiny shared store for a sidebar badge count (e.g. items awaiting
 * the signed-in user). Pages that change the underlying data call `refresh()`
 * so the badge updates immediately.
 *
 * @param {() => Promise<number>} fetchCount - Loads the current count.
 */
export function createCountStore(fetchCount) {
  let count = 0;
  const listeners = new Set();

  const set = (value) => {
    if (value === count) return;
    count = value;
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  /** Re-fetch the count; failures keep the last value (the badge is a convenience). */
  const refresh = async () => {
    try {
      set(await fetchCount());
    } catch {
      // Ignore: the page itself shows errors.
    }
  };

  const clear = () => set(0);

  /** Current count; refreshes whenever `refreshKey` changes. `enabled = false` for roles without the badge. */
  const useCount = (enabled, refreshKey) => {
    useEffect(() => {
      if (enabled) refresh();
      else clear();
    }, [enabled, refreshKey]);
    return useSyncExternalStore(subscribe, () => count);
  };

  return { refresh, clear, useCount };
}
