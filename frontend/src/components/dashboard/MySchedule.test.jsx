import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import MySchedule from './MySchedule';

const TODAY = '2026-10-15'; // a Thursday; the window starts Monday Oct 12

function project(overrides = {}) {
  return {
    project_id: 7,
    name: 'Apollo',
    status: 'active',
    start_date: '2026-10-01',
    predicted_end_date: '2026-11-20',
    hours_per_week: 16,
    pending_hours: null,
    milestones: [],
    ...overrides,
  };
}

const renderSchedule = (schedule) => renderWithProviders(<MySchedule schedule={schedule} today={TODAY} />);

describe('MySchedule', () => {
  it('shows each project with its hours per week and per day', () => {
    renderSchedule([project()]);
    const rows = screen.getByRole('list', { name: 'My projects over the next 12 weeks' });
    expect(within(rows).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/7');
    expect(within(rows).getByText('16 h/week · 3 h 12 min a day')).toBeInTheDocument();
    expect(within(rows).getByRole('img', { name: 'Apollo: Oct 1, 2026 to Nov 20, 2026' })).toBeInTheDocument();
  });

  it('marks milestones as due, completed or overdue', () => {
    renderSchedule([project({
      milestones: [
        { id: 1, title: 'Kick-off', due_date: '2026-10-13', status: 'completed' },
        { id: 2, title: 'Design', due_date: '2026-10-14', status: 'in_progress' },
        { id: 3, title: 'Launch', due_date: '2026-11-18', status: 'not_started' },
        { id: 4, title: 'Long ago', due_date: '2026-09-01', status: 'completed' }, // before the window
      ],
    })]);
    expect(screen.getByRole('img', { name: 'Kick-off: completed Oct 13, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Design: overdue Oct 14, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Launch: due Nov 18, 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Long ago/ })).not.toBeInTheDocument();
  });

  it('shows hours awaiting approval, and projects starting after the window', () => {
    renderSchedule([
      project({ hours_per_week: null, pending_hours: 8 }),
      project({ project_id: 8, name: 'Borealis', hours_per_week: 10, pending_hours: 14 }),
      project({ project_id: 9, name: 'Cosmos', start_date: '2027-03-01', predicted_end_date: '2027-05-01' }),
    ]);
    expect(screen.getByText('8 h/week awaiting approval')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Apollo: Oct 1, 2026 to Nov 20, 2026, awaiting approval' })).toBeInTheDocument();
    expect(screen.getByText('Increase to 14 h/week awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Starts Mar 1, 2027')).toBeInTheDocument();
  });

  it('totals the hours of every project running each week', () => {
    renderSchedule([
      project(),
      project({ project_id: 8, name: 'Borealis', start_date: '2026-10-26', predicted_end_date: '2026-12-31', hours_per_week: 8, pending_hours: 12 }),
    ]);
    expect(screen.getByRole('img', { name: 'Week of Oct 12, 2026: 16 h of 40' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Week of Oct 26, 2026: 24 h of 40, plus 4 h awaiting approval' })).toBeInTheDocument();
    // Apollo has ended by December, leaving Borealis alone.
    expect(screen.getByRole('img', { name: 'Week of Dec 7, 2026: 8 h of 40, plus 4 h awaiting approval' })).toBeInTheDocument();
  });

  it('says so when there are no current projects', () => {
    renderSchedule([]);
    expect(screen.getByText("You aren't on any current projects.")).toBeInTheDocument();
  });
});
