import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, mockFetchSequence } from '../test/fetch';

const USER = { id: 3, employee_id: 'EMP001', first_name: 'Eli', last_name: 'Employee', role: 'employee' };
const TOKENS = { access_token: 'a1', refresh_token: 'r1', expires_in: 900 };

/** Load fresh module copies so session state from other tests does not leak in. */
async function setup() {
  vi.resetModules();
  const { default: AuthProvider } = await import('./AuthProvider');
  const { useAuth } = await import('./authContext');
  const { default: NotificationProvider } = await import('../components/feedback/NotificationProvider');

  function Probe() {
    const { status, user, login, logout } = useAuth();
    return (
      <div>
        <p>status: {status}</p>
        <p>user: {user?.employee_id ?? 'none'}</p>
        <button type="button" onClick={() => login('EMP001', 'Empl01')}>login</button>
        <button type="button" onClick={logout}>logout</button>
      </div>
    );
  }

  render(
    <NotificationProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </NotificationProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('AuthProvider', () => {
  it('starts anonymous without stored tokens and signs in', async () => {
    const fetchMock = mockFetchSequence(jsonResponse(200, { ...TOKENS, user: USER }));
    await setup();
    expect(screen.getByText('status: anonymous')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(await screen.findByText('user: EMP001')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
    expect(JSON.parse(localStorage.getItem('projecthub.session')).accessToken).toBe('a1');
  });

  it('restores a stored session on load', async () => {
    localStorage.setItem('projecthub.session', JSON.stringify({ accessToken: 'old', refreshToken: 'r0' }));
    mockFetchSequence(jsonResponse(200, { ...TOKENS, user: USER }));
    await setup();
    expect(screen.getByText('status: initializing')).toBeInTheDocument();
    expect(await screen.findByText('status: authenticated')).toBeInTheDocument();
  });

  it('falls back to anonymous when the stored session is no longer valid', async () => {
    localStorage.setItem('projecthub.session', JSON.stringify({ accessToken: 'old', refreshToken: 'bad' }));
    mockFetchSequence(jsonResponse(401, { error: { code: 'unauthorized', message: 'Invalid' } }));
    await setup();
    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
    expect(localStorage.getItem('projecthub.session')).toBeNull();
  });

  it('signs out locally even if the logout call fails', async () => {
    mockFetchSequence(jsonResponse(200, { ...TOKENS, user: USER }));
    await setup();
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    await screen.findByText('user: EMP001');

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await act(() => userEvent.click(screen.getByRole('button', { name: 'logout' })));
    await waitFor(() => expect(screen.getByText('status: anonymous')).toBeInTheDocument());
    expect(localStorage.getItem('projecthub.session')).toBeNull();
  });
});
