/**
 * Central map of which roles may perform which UI actions.
 *
 * The backend enforces every rule; this map only decides what the UI shows,
 * so users are not offered actions they cannot perform.
 */

export const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
};

const PERMISSIONS = {
  'audit.view': ['admin'],
  'users.manage': ['admin'],
  'projects.create': ['admin'],
  'projects.archive': ['admin'],
  'projects.manage': ['admin', 'manager'],
  'requests.create': ['manager'],
  'requests.review': ['admin'],
};

/** Return true if `user` may perform `permission`. */
export function can(user, permission) {
  const roles = PERMISSIONS[permission];
  if (!roles) throw new Error(`Unknown permission: ${permission}`);
  return Boolean(user && roles.includes(user.role));
}
