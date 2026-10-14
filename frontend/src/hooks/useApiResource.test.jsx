import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useApiResource from './useApiResource';

function Probe({ fetcher }) {
  const resource = useApiResource(fetcher, { refreshInterval: 1000 });
  return <p>{resource.status}: {String(resource.data)}</p>;
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => vi.useRealTimers());

describe('useApiResource background refresh', () => {
  it('re-fetches quietly on the interval while the tab is visible', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValue('second');
    render(<Probe fetcher={fetcher} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('success: first')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('success: second')).toBeInTheDocument();
  });

  it('pauses while the tab is hidden', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');
    render(<Probe fetcher={fetcher} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    setVisibility('hidden');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good data if a background refresh fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('good').mockRejectedValue(new Error('offline'));
    render(<Probe fetcher={fetcher} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('success: good')).toBeInTheDocument();
  });
});
