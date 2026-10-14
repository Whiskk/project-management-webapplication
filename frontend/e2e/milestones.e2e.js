import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

/** Open the milestone dialog (new or edit), fill what's given, and save. */
async function saveMilestone(page, opener, { title, start, due, status, dependsOn } = {}) {
  await page.getByRole('button', opener).click();
  const dialog = page.getByRole('dialog');
  if (title) await dialog.getByLabel('Title').fill(title);
  if (dependsOn) {
    await dialog.getByLabel('Depends on').click();
    await page.getByRole('option', { name: new RegExp(dependsOn) }).click();
  }
  if (start) await dialog.getByLabel('Start date').fill(start);
  if (due) await dialog.getByLabel('Due date').fill(due);
  if (status) {
    await dialog.getByRole('combobox', { name: /^Status/ }).click();
    await page.getByRole('option', { name: status, exact: true }).click();
  }
  await dialog.getByRole('button', { name: /^(Add milestone|Save changes)$/ }).click();
  return dialog;
}

test('milestone dependencies keep work in order', async ({ page }) => {
  const name = unique('Roadmap');
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, { start: '2032-03-01', end: '2032-03-26' });
  await signOut(page);

  await signIn(page, 'manager');
  await page.goto(projectUrl);
  await saveMilestone(page, { name: 'Add milestone' }, { title: 'Design', start: '2032-03-01', due: '2032-03-05' });
  await expect(page.getByRole('listitem', { name: 'Design' })).toBeVisible();

  // "Build" depends on "Design", so it cannot start before Design is due...
  const dialog = await saveMilestone(page, { name: 'Add milestone' }, {
    title: 'Build', dependsOn: 'Design', start: '2032-03-03', due: '2032-03-19',
  });
  await expect(dialog.getByText(/when 'Design' is due/)).toBeVisible();

  // ...and cannot be in progress until Design is completed.
  await dialog.getByLabel('Start date').fill('2032-03-08');
  await dialog.getByRole('combobox', { name: /^Status/ }).click();
  await page.getByRole('option', { name: 'In progress', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  await expect(dialog.getByText('Waiting on: Design')).toBeVisible();

  // Saved as not started, it shows what it is waiting on.
  await dialog.getByRole('combobox', { name: /^Status/ }).click();
  await page.getByRole('option', { name: 'Not started', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  const build = page.getByRole('listitem', { name: 'Build' });
  await expect(build.getByText('Waiting on 1')).toBeVisible();

  // Completing Design unblocks Build.
  await saveMilestone(page, { name: 'Edit Design' }, { status: 'Completed' });
  await expect(page.getByRole('listitem', { name: 'Design' }).getByText('Completed')).toBeVisible();
  await saveMilestone(page, { name: 'Edit Build' }, { status: 'In progress' });
  await expect(build.getByText('In progress')).toBeVisible();
  await expect(page.getByText('1 of 2 completed (50%)')).toBeVisible();
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});
