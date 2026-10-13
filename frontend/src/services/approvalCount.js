import { useEffect, useSyncExternalStore } from 'react';
import { projectsApi } from './projectsApi';

/**
 * Shared count of hour requests awaiting the signed-in manager's approval.
 * The sidebar badge reads it; the Approvals page refreshes it after decisions.
 */
let count = 0;
const listeners = new Set();

function setCount(value) {
  if (value === count) return;
  count = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-fetch the count. Failures leave the last known value (the badge is a convenience). */
export async function refreshApprovalCount() {
  try {
    const data = await projectsApi.approvals();
    setCount(data.total);
  } catch {
    // Ignore: the Approvals page shows its own errors.
  }
}

/** Reset when signing out or switching to a role without approvals. */
export function clearApprovalCount() {
  setCount(0);
}

/**
 * Current count; refreshes whenever `refreshKey` changes (e.g. on navigation).
 * Pass `enabled = false` for roles that never approve.
 */
export function useApprovalCount(enabled, refreshKey) {
  useEffect(() => {
    if (enabled) refreshApprovalCount();
    else clearApprovalCount();
  }, [enabled, refreshKey]);
  return useSyncExternalStore(subscribe, () => count);
}
