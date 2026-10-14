import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`);
  expect(report, `Accessibility violations on ${label}`).toEqual([]);
}

/** Manager: add a milestone through the dialog. */
async function addMilestone(page, title, start, due, dependsOn) {
  await page.getByRole('button', { name: 'Add milestone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  if (dependsOn) {
    await dialog.getByLabel('Depends on').click();
    await page.getByRole('option', { name: new RegExp(dependsOn) }).click();
  }
  await dialog.getByLabel('Start date').fill(start);
  await dialog.getByLabel('Due date').fill(due);
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByRole('listitem', { name: title, exact: true })).toBeVisible();
}

/** Manager: open a milestone's checklist and add a task assigned to Eli. */
async function addTaskForEli(page, milestone, title) {
  const row = page.getByRole('listitem', { name: milestone, exact: true });
  const toggle = row.getByRole('button', { name: /^Tasks/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await row.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: `New task in ${milestone}` });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('combobox', { name: /^Assignee/ }).click();
  await page.getByRole('option', { name: 'Eli Employee' }).click();
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText(`Task '${title}' added`)).toBeVisible();
}

test('managers assign tasks inside milestones and employees tick them off', async ({ page }) => {
  const name = unique('Tasks');
  // Task titles unique to this run, so leftovers from an interrupted run never match.
  const run = name.split(' ').pop();
  const wireframes = `Wireframes ${run}`;
  const api = `Implement API ${run}`;

  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, { start: '2032-07-05', end: '2032-07-30' });
  await signOut(page);

  // Morgan staffs Eli, plans two milestones and gives Eli a task in each.
  await signIn(page, 'manager');
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Assign' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await assign.getByLabel('Hours per week').fill('4');
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByRole('table', { name: 'Team' }).getByText('Eli Employee')).toBeVisible();

  await addMilestone(page, 'Design', '2032-07-05', '2032-07-09');
  await addMilestone(page, 'Build', '2032-07-12', '2032-07-23', 'Design');
  await addTaskForEli(page, 'Design', wireframes);
  await addTaskForEli(page, 'Build', api);
  await expect(page.getByText(/0 of 2 tasks done/)).toBeVisible();
  await expectAccessible(page, 'project with task checklists open');

  // Design can't be completed while its task is open.
  await page.getByRole('button', { name: 'Edit Design' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Status/ }).click();
  await page.getByRole('option', { name: 'In progress', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Edit Design' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Status/ }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText(/Cannot mark as completed: 1 task\(s\) still open/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await signOut(page);

  // Eli ticks Wireframes off from the dashboard; the Build task waits for Design.
  await signIn(page, 'employee');
  const myTasks = page.getByRole('list', { name: 'My tasks' });
  await expect(myTasks.getByRole('checkbox', { name: api })).toBeDisabled();
  await expectAccessible(page, 'employee dashboard with tasks');
  await myTasks.getByRole('checkbox', { name: wireframes }).click(); // the task then leaves the list
  await expect(page.getByText(`Completed '${wireframes}'`)).toBeVisible();
  await expect(myTasks.getByRole('checkbox', { name: wireframes })).toHaveCount(0);
  await signOut(page);

  // Morgan sees the progress and can now complete Design; the tick is in the project history.
  await signIn(page, 'manager');
  await page.goto(projectUrl);
  await expect(page.getByText(/1 of 2 tasks done/)).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Design', exact: true }).getByRole('button', { name: 'Tasks 1/1' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Design' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Status/ }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Milestone updated')).toBeVisible();
  await expect(page.getByText(`Eli Employee completed task '${wireframes}'`)).toBeVisible();
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});
