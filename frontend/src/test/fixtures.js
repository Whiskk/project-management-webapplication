import { TEST_USERS } from './render';

/** A project as returned by the API (admin/manager view). */
export function makeProject(overrides = {}) {
  return {
    id: 7,
    name: 'Apollo',
    description: 'Customer portal rebuild',
    start_date: '2026-11-02',
    predicted_end_date: '2026-11-13',
    working_days: 10,
    capacity_hours: 80,
    manager_id: TEST_USERS.manager.id,
    manager_name: 'Morgan Manager',
    manager_employee_id: 'MGR001',
    budget: 50000,
    status: 'active',
    is_archived: false,
    archived_at: null,
    team_size: 2,
    created_at: '2026-10-13T10:00:00Z',
    ...overrides,
  };
}
