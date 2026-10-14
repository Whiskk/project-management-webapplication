import { expect } from '@playwright/test';

/** Demo accounts; passwords default to the local-only demo values. */
export const USERS = {
  admin: { id: 'AA7K2P', password: process.env.E2E_ADMIN_PASSWORD || 'Admin1', name: 'Alex Admin' },
  manager: { id: 'MM4R8T', password: process.env.E2E_MANAGER_PASSWORD || 'Mngr01', name: 'Morgan Manager' },
  employee: { id: 'EE3H9W', password: process.env.E2E_EMPLOYEE_PASSWORD || 'Empl01', name: 'Eli Employee' },
};

/** A name unique to this run, so journeys never collide with real data. */
export const unique = (label) => `E2E ${label} ${Date.now().toString(36)}`;

/** Sign in through the login form and wait for the dashboard. */
export async function signIn(page, role) {
  const user = USERS[role];
  await page.goto('/login');
  await page.getByLabel('Employee ID').fill(user.id);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** Sign out via the account menu. */
export async function signOut(page) {
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

/** Admin: create a project for Morgan through the UI and return to its page. */
export async function createProject(page, name, { start = '2032-03-01', end = '2032-03-12', budget = '100000' } = {}) {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Start date').fill(start);
  await dialog.getByLabel('Predicted end date').fill(end);
  await dialog.getByLabel('Budget').fill(budget);
  await dialog.getByRole('combobox', { name: /^Project manager/ }).click();
  await page.getByRole('option', { name: /Morgan Manager/ }).click();
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page.url();
}

/** Admin: archive the project currently open (cleanup). */
export async function archiveCurrentProject(page) {
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText(/Archived on/)).toBeVisible();
}
