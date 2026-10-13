import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import { can } from './permissions';
import RequireAuth from './RequireAuth';
import RequirePermission from './RequirePermission';

function renderGuarded(auth) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<p>Private page</p>} />
        <Route element={<RequirePermission permission="audit.view" />}>
          <Route path="/audit" element={<p>Audit page</p>} />
        </Route>
      </Route>
    </Routes>,
    { auth, route: auth.route },
  );
}

describe('RequireAuth', () => {
  it('redirects anonymous users to login', () => {
    renderGuarded({ ...fakeAuth({ status: 'anonymous', user: null }), route: '/' });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows a spinner while restoring the session', () => {
    renderGuarded({ ...fakeAuth({ status: 'initializing', user: null }), route: '/' });
    expect(screen.getByLabelText('Restoring your session')).toBeInTheDocument();
  });

  it('renders the page for signed-in users', () => {
    renderGuarded({ ...fakeAuth(), route: '/' });
    expect(screen.getByText('Private page')).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  it('allows roles with the permission', () => {
    renderGuarded({ ...fakeAuth({ user: TEST_USERS.admin }), route: '/audit' });
    expect(screen.getByText('Audit page')).toBeInTheDocument();
  });

  it.each(['manager', 'employee'])('shows access denied to %s', (role) => {
    renderGuarded({ ...fakeAuth({ user: TEST_USERS[role] }), route: '/audit' });
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('Audit page')).not.toBeInTheDocument();
  });
});

describe('can', () => {
  it('maps roles to permissions', () => {
    expect(can(TEST_USERS.admin, 'projects.create')).toBe(true);
    expect(can(TEST_USERS.manager, 'projects.create')).toBe(false);
    expect(can(TEST_USERS.manager, 'requests.create')).toBe(true);
    expect(can(TEST_USERS.employee, 'projects.manage')).toBe(false);
    expect(can(null, 'projects.manage')).toBe(false);
  });

  it('throws on typos so permission checks cannot silently fail open or closed', () => {
    expect(() => can(TEST_USERS.admin, 'project.create')).toThrow('Unknown permission');
  });
});
