import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

test('core journey: admin creates, manager plans and staffs, employee sees it', async ({ page }) => {
  const name = unique('Apollo');

  // Admin creates the project for Morgan.
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name);
  await signOut(page);

  // Manager adds a milestone and staffs Eli (one of Morgan's direct reports, so no approval needed).
  await signIn(page, 'manager');
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Add milestone' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Kick-off');
  await dialog.getByLabel('Start date').fill('2032-03-01');
  await dialog.getByLabel('Due date').fill('2032-03-05');
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByRole('listitem', { name: 'Kick-off' })).toBeVisible();

  await page.getByRole('button', { name: 'Assign' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await dialog.getByLabel('Hours per week').fill('5');
  await expect(dialog.getByText('Remaining budget')).toBeVisible();
  await dialog.getByRole('button', { name: 'Assign' }).click();
  const team = page.getByRole('table', { name: 'Team' });
  await expect(team.getByText('Eli Employee')).toBeVisible();
  await expect(team.getByText('5 h', { exact: true })).toBeVisible();
  await signOut(page);

  // Employee sees the project with their hours.
  await signIn(page, 'employee');
  await page.goto('/projects');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText('5 h')).toBeVisible();
  await signOut(page);

  // Cleanup: archive (projects are never deleted).
  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});

test('the budget rule blocks staffing beyond the budget', async ({ page }) => {
  const name = unique('Tight budget');
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, { budget: '100' });
  await signOut(page);

  await signIn(page, 'manager');
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Assign' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await dialog.getByLabel('Hours per week').fill('10');
  await expect(dialog.getByText(/would exceed the project budget/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Assign' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});
