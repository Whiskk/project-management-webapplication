/**
 * Session (token) management.
 *
 * Holds the access/refresh tokens, persists them in localStorage so a page
 * reload keeps the user signed in, and plugs token refresh into the API
 * client. Concurrent requests that hit an expired token share one refresh.
 */

import { api, configureAuth } from './api';

const STORAGE_KEY = 'projecthub.session';

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored?.accessToken && stored?.refreshToken ? stored : null;
  } catch {
    return null;
  }
}

let session = load();
let refreshPromise = null;
let expiredListener = () => {};

/** True when tokens are stored (they may still need refreshing). */
export function hasSession() {
  return session !== null;
}

/** Store tokens returned by login/refresh. */
export function startSession({ access_token: accessToken, refresh_token: refreshToken }) {
  session = { accessToken, refreshToken };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
}

/** Forget all tokens. */
export function endSession() {
  session = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/** Register a callback for when the session expires mid-use. */
export function onSessionExpired(listener) {
  expiredListener = listener;
}

/** Exchange the refresh token for new tokens. Concurrent callers share one request. */
export function refreshSession() {
  if (!session?.refreshToken) return Promise.reject(new Error('No session'));
  if (!refreshPromise) {
    const { refreshToken } = session;
    refreshPromise = api
      .post('auth', '/refresh', { refresh_token: refreshToken })
      .then((data) => {
        startSession(data);
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

configureAuth({
  getAccessToken: () => session?.accessToken ?? null,
  refresh: refreshSession,
  onAuthFailure: () => {
    if (session) {
      endSession();
      expiredListener();
    }
  },
});
