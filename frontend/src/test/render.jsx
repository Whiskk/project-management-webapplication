import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import { AuthContext } from '../auth/authContext';
import NotificationProvider from '../components/feedback/NotificationProvider';
import theme from '../theme';

export const TEST_USERS = {
  admin: {
    id: 1, employee_id: 'AA7K2P', first_name: 'Alex', last_name: 'Admin',
    email: 'alex.admin@example.com', job_title: 'Administrator', role: 'admin', manager_id: null,
  },
  manager: {
    id: 2, employee_id: 'MM4R8T', first_name: 'Morgan', last_name: 'Manager',
    email: 'morgan.manager@example.com', job_title: 'Engineering Manager', role: 'manager', manager_id: null,
  },
  employee: {
    id: 3, employee_id: 'EE3H9W', first_name: 'Eli', last_name: 'Employee',
    email: 'eli.employee@example.com', job_title: 'Software Engineer', role: 'employee', manager_id: 2,
  },
};

/** Build a fake auth context value; defaults to a signed-in admin. */
export function fakeAuth(overrides = {}) {
  return {
    status: 'authenticated',
    user: TEST_USERS.admin,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

/**
 * Render a component with the app's providers and an in-memory router.
 *
 * @param {object} [options]
 * @param {string|object} [options.route] - Initial location.
 * @param {object|null} [options.auth] - Fake auth context; pass null to supply your own provider.
 */
export function renderWithProviders(ui, { route = '/', auth = fakeAuth() } = {}) {
  const routed = <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>;
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        {auth ? <AuthContext.Provider value={auth}>{routed}</AuthContext.Provider> : routed}
      </NotificationProvider>
    </ThemeProvider>,
  );
}
