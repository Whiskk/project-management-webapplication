import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, mockFetchSequence } from '../test/fetch';

const TOKENS = { access_token: 'a1', refresh_token: 'r1' };

/** Import a fresh copy of the session module (it reads localStorage on load). */
async function loadSession() {
  vi.resetModules();
  return import('./session');
}

beforeEach(() => localStorage.clear());

describe('session', () => {
  it('persists tokens across reloads and clears them on end', async () => {
    let session = await loadSession();
    expect(session.hasSession()).toBe(false);
    session.startSession(TOKENS);

    session = await loadSession();
    expect(session.hasSession()).toBe(true);
    session.endSession();
    expect(session.hasSession()).toBe(false);
    expect(localStorage.getItem('projecthub.session')).toBeNull();
  });

  it('ignores corrupted storage', async () => {
    localStorage.setItem('projecthub.session', '{not json');
    const session = await loadSession();
    expect(session.hasSession()).toBe(false);
  });

  it('shares one refresh request between concurrent callers and stores new tokens', async () => {
    const session = await loadSession();
    session.startSession(TOKENS);
    const fetchMock = mockFetchSequence(
      jsonResponse(200, { access_token: 'a2', refresh_token: 'r2', user: { id: 1 } }),
    );

    const [first, second] = await Promise.all([session.refreshSession(), session.refreshSession()]);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'r1' });
    expect(JSON.parse(localStorage.getItem('projecthub.session'))).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('rejects refresh without a session', async () => {
    const session = await loadSession();
    await expect(session.refreshSession()).rejects.toThrow('No session');
  });

  it('notifies the listener once when an authenticated request is finally rejected', async () => {
    const session = await loadSession();
    const { api } = await import('./api');
    session.startSession(TOKENS);
    const listener = vi.fn();
    session.onSessionExpired(listener);
    mockFetchSequence(jsonResponse(401, { error: { code: 'unauthorized', message: 'Inactive' } }));

    await api.get('projects').catch(() => {});
    expect(listener).toHaveBeenCalledOnce();
    expect(session.hasSession()).toBe(false);
  });
});
