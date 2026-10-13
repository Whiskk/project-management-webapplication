import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotify } from '../components/feedback/notificationContext';
import { api } from '../services/api';
import { endSession, hasSession, onSessionExpired, refreshSession, startSession } from '../services/session';
import { AuthContext } from './authContext';

/** Provides the signed-in user and login/logout actions to the app. */
export default function AuthProvider({ children }) {
  const notify = useNotify();
  const [state, setState] = useState(() => ({
    status: hasSession() ? 'initializing' : 'anonymous',
    user: null,
  }));

  // Restore a stored session on page load.
  useEffect(() => {
    if (!hasSession()) return;
    refreshSession()
      .then((data) => setState({ status: 'authenticated', user: data.user }))
      .catch(() => {
        endSession();
        setState({ status: 'anonymous', user: null });
      });
  }, []);

  useEffect(() => {
    onSessionExpired(() => {
      setState({ status: 'anonymous', user: null });
      notify('Your session has expired. Please sign in again.', 'warning');
    });
  }, [notify]);

  const login = useCallback(async (employeeId, password) => {
    const data = await api.post('auth', '/login', { employee_id: employeeId, password });
    startSession(data);
    setState({ status: 'authenticated', user: data.user });
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('auth', '/logout');
    } catch {
      // Signing out locally must always succeed, even if the API call fails.
    }
    endSession();
    setState({ status: 'anonymous', user: null });
  }, []);

  /** Merge updated profile fields into the signed-in user (e.g. after editing their profile). */
  const updateUser = useCallback((changes) => {
    setState((current) => (current.user ? { ...current, user: { ...current.user, ...changes } } : current));
  }, []);

  const value = useMemo(() => ({ ...state, login, logout, updateUser }), [state, login, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
