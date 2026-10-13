import { useCallback, useEffect, useState } from 'react';

/**
 * Load data from the API with loading/error state, abort-on-unmount and reload.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher - Must be stable (wrap in useCallback).
 * @returns {{status: 'loading'|'success'|'error', data: any, error: Error|null, reload: () => void}}
 */
export default function useApiResource(fetcher) {
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

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    setReloadKey((key) => key + 1);
  }, []);

  return { ...state, reload };
}
