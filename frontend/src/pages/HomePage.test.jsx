import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../services/api';
import { renderWithProviders } from '../test/render';
import HomePage from './HomePage';

describe('HomePage', () => {
  it('shows connectivity once the health check succeeds', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 1 });
    renderWithProviders(<HomePage />);
    expect(screen.getByLabelText('Loading system status')).toBeInTheDocument();
    expect(await screen.findByText('Database connected')).toBeInTheDocument();
    expect(screen.getByText('Schema v1')).toBeInTheDocument();
  });

  it('shows an error with a working retry button', async () => {
    const get = vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'Unable to reach the server.'))
      .mockResolvedValueOnce({ status: 'ok', database: 'ok', schema_version: 1 });
    renderWithProviders(<HomePage />);
    expect(await screen.findByText('Unable to reach the server.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('API online')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
