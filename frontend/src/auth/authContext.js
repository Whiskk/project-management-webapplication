import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

/**
 * Access the auth state: `{ status, user, login, logout }`.
 * `status` is 'initializing' | 'authenticated' | 'anonymous'.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
