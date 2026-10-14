import { useCallback, useEffect, useState } from 'react';

/**
 * Load data from the API with loading/error state, abort-on-unmount and reload.
 *
 * With `refreshInterval` (ms) the data is also re-fetched quietly in the
 * background while the browser tab is visible - near-real-time updates
 * without WebSockets, which Lambda function URLs do not support. Background
 * refreshes never show a loading state, and a failed one keeps the last data.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher - Must be stable (wrap in useCallback).
 * @param {{ refreshInterval?: number }} [options]
 * @returns {{status: 'loading'|'success'|'error', data: any, error: Error|null, reload: () => void}}
 */
export default function useApiResource(fetcher, { refreshInterval } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((data) => setState({ status: 'success', data, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', data: null, error });
      });
    return () => controller.abort();
  }, [fetcher, reloadKey]);

  useEffect(() => {
    if (!refreshInterval) return undefined;
    let controller = null;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      fetcher(controller.signal)
        .then((data) => setState({ status: 'success', data, error: null }))
        .catch(() => {
          // Keep showing the last good data; the next tick will try again.
        });
    }, refreshInterval);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [fetcher, refreshInterval]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    setReloadKey((key) => key + 1);
  }, []);

  return { ...state, reload };
}
