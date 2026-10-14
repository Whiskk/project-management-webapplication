import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createCountStore } from './countStore';

function Badge({ store, enabled = true }) {
  const count = store.useCount(enabled, 'key');
  return <p>count: {count}</p>;
}

describe('createCountStore', () => {
  it('loads the count and updates every reader on refresh', async () => {
    const fetchCount = vi.fn().mockResolvedValue(2);
    const store = createCountStore(fetchCount);
    render(<><Badge store={store} /><Badge store={store} /></>);
    expect(await screen.findAllByText('count: 2')).toHaveLength(2);
    fetchCount.mockResolvedValue(0); // e.g. the admin just decided the last pending request
    await act(() => store.refresh());
    expect(screen.getAllByText('count: 0')).toHaveLength(2);
  });

  it('keeps the last value when a refresh fails', async () => {
    const store = createCountStore(vi.fn().mockResolvedValueOnce(3).mockRejectedValueOnce(new Error('offline')));
    render(<Badge store={store} />);
    expect(await screen.findByText('count: 3')).toBeInTheDocument();
    await act(() => store.refresh());
    expect(screen.getByText('count: 3')).toBeInTheDocument();
  });

  it('does not fetch for roles without the badge', () => {
    const fetchCount = vi.fn();
    render(<Badge store={createCountStore(fetchCount)} enabled={false} />);
    expect(screen.getByText('count: 0')).toBeInTheDocument();
    expect(fetchCount).not.toHaveBeenCalled();
  });
});
