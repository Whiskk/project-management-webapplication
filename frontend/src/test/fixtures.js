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
    allocated_hours: 20,
    projected_cost: 3000,
    remaining_budget: 47000,
    over_budget: false,
    my_hours_per_week: null,
    my_pending_hours: null,
    insights: [],
    milestones: { total: 0, completed: 0, overdue: 0 },
    created_at: '2026-10-13T10:00:00Z',
    ...overrides,
  };
}

/** A team member as returned by GET /projects/{id}/assignments. */
export function makeAssignment(overrides = {}) {
  return {
    id: 31,
    user_id: TEST_USERS.employee.id,
    employee_id: 'EMP001',
    first_name: 'Eli',
    last_name: 'Employee',
    job_title: 'Software Engineer',
    status: 'approved',
    hours_per_week: 10,
    pending_hours: null,
    reserved_hours: 10,
    awaiting_approval: false,
    approver_name: 'Morgan Manager',
    requested_by_name: null,
    requested_at: null,
    total_hours: 20,
    cost: 1000,
    ...overrides,
  };
}

/** An entry from GET /projects/{id}/staffing-options ($50/hour over a two-week project). */
export function makeStaffingOption(overrides = {}) {
  return {
    user_id: TEST_USERS.employee.id,
    employee_id: 'EMP001',
    first_name: 'Eli',
    last_name: 'Employee',
    job_title: 'Software Engineer',
    manager_name: 'Morgan Manager',
    needs_approval: false,
    assignment_id: null,
    assigned_hours: null,
    committed_hours_elsewhere: 25,
    available_hours: 15,
    cost_per_weekly_hour: 100,
    ...overrides,
  };
}
