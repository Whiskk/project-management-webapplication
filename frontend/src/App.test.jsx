import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './services/api';
import { renderWithProviders } from './test/render';

describe('App routing and layout', () => {
  it('renders the dashboard with a mobile navigation drawer', async () => {
    // jsdom has no viewport width, so the shell renders its mobile layout.
    vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 1 });
    renderWithProviders(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('API online')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveClass('active');
  });

  it('shows a not-found page with a link back to the dashboard', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 1 });
    renderWithProviders(<App />, { route: '/does-not-exist' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
