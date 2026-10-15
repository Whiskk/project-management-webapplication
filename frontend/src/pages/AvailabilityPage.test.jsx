import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectsApi } from '../services/projectsApi';
import { TEST_USERS, fakeAuth, renderWithProviders } from '../test/render';
import { addDays, todayIso, weekStart } from '../utils/schedule';
import AvailabilityPage from './AvailabilityPage';

const MONDAY = weekStart(todayIso());
const week = (booked, confirmed, pending) => ({ booked, confirmed, pending, free: Math.max(40 - booked, 0) });

function payload() {
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: addDays(MONDAY, 7 * i), end: addDays(MONDAY, 7 * i + 4) }));
  const fill = (first) => [first, ...Array.from({ length: 11 }, () => week(0, 0, 0))];
  return {
    weeks,
    capacity: 40,
    people: [
      {
        user_id: 3, employee_id: 'EE3H9W', first_name: 'Eli', last_name: 'Employee', job_title: 'Engineer',
        manager_name: 'Morgan Manager', is_my_report: true, weeks: fill(week(25, 10, 15)),
      },
      {
        user_id: 9, employee_id: 'OO1234', first_name: 'Olive', last_name: 'Other', job_title: 'Designer',
        manager_name: 'Pat Other', is_my_report: false, weeks: fill(week(40, 40, 0)),
      },
    ],
  };
}

const renderPage = (user = TEST_USERS.manager, route = '/availability') => renderWithProviders(<AvailabilityPage />, { auth: fakeAuth({ user }), route });
const rowNames = () => screen.getAllByRole('rowheader').map((cell) => within(cell).getByText(/Eli|Olive/).textContent);

beforeEach(() => {
  vi.spyOn(projectsApi, 'availability').mockResolvedValue(payload());
});

describe('AvailabilityPage', () => {
  it('shows managers their own team first, with free and booked hours per week', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    expect(rowNames()).toEqual(['Eli Employee']);
    expect(within(table).getByRole('columnheader', { name: /This week/ })).toBeInTheDocument();
    // The screen-reader text spells the cell out; the visible text is short.
    expect(within(table).getByText('15 h free: 25 h of 40 booked, including 15 h awaiting approval')).toBeInTheDocument();
    expect(within(table).getByText('25 h booked')).toBeInTheDocument();
    expect(projectsApi.availability).toHaveBeenCalledWith({ start: MONDAY, weeks: 12 }, expect.anything());
  });

  it('can show everyone and search by name', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(rowNames()).toEqual(['Eli Employee', 'Olive Other']);
    expect(screen.getByText('Reports to Pat Other')).toBeInTheDocument();
    expect(screen.getAllByText('Full').length).toBeGreaterThan(0);

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'designer');
    expect(rowNames()).toEqual(['Olive Other']);
  });

  it('shows admins everyone, with no team toggle', async () => {
    renderPage(TEST_USERS.admin);
    await screen.findByRole('table');
    expect(rowNames()).toEqual(['Eli Employee', 'Olive Other']);
    expect(screen.queryByRole('button', { name: 'My team' })).not.toBeInTheDocument();
  });

  it('moves the window four weeks at a time', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(projectsApi.availability).toHaveBeenLastCalledWith(
      { start: addDays(MONDAY, 28), weeks: 12 }, expect.anything(),
    ));
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() => expect(projectsApi.availability).toHaveBeenLastCalledWith({ start: MONDAY, weeks: 12 }, expect.anything()));
  });

  it('starts from the week given in the URL, moved back to its Monday', async () => {
    renderPage(TEST_USERS.manager, '/availability?start=2033-05-11');
    await screen.findByRole('table');
    expect(projectsApi.availability).toHaveBeenCalledWith({ start: '2033-05-09', weeks: 12 }, expect.anything());
  });

  it('ignores a start date in the URL that is not a date', async () => {
    renderPage(TEST_USERS.manager, '/availability?start=soon');
    await screen.findByRole('table');
    expect(projectsApi.availability).toHaveBeenCalledWith({ start: MONDAY, weeks: 12 }, expect.anything());
  });

  it('tells a manager with no reports to look at everyone', async () => {
    const data = payload();
    data.people.forEach((person) => { person.is_my_report = false; });
    projectsApi.availability.mockResolvedValue(data);
    renderPage();
    expect(await screen.findByText(/You have no direct reports/)).toBeInTheDocument();
  });
});
