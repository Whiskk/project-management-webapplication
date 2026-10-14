import { expect, test } from '@playwright/test';
import { signIn, signOut, USERS } from './helpers';

/** Admin: open the audit log filtered by a search term; returns the newest matching row. */
async function newestAuditRow(page, search) {
  await page.goto('/audit');
  await page.getByLabel('Search').fill(search);
  const row = page.getByRole('table', { name: 'Audit log' }).getByRole('row').filter({ hasText: search }).first();
  await expect(row).toBeVisible();
  return row;
}

test('employees edit only their own name and email, and the change is audited', async ({ page }) => {
  const newEmail = `eli.e2e.${Date.now().toString(36)}@example.com`;

  await signIn(page, 'employee');
  await page.goto('/profile');
  // Role and job title are shown but cannot be edited.
  await expect(page.getByRole('textbox', { name: 'Job title' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Role' })).toHaveCount(0);

  const email = page.getByRole('textbox', { name: 'Email' });
  const originalEmail = await email.inputValue();
  await email.fill(newEmail);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await signOut(page);

  // The admin sees who changed what, with before and after values.
  await signIn(page, 'admin');
  const row = await newestAuditRow(page, 'Eli Employee updated their profile');
  await row.getByRole('button', { name: 'Show details' }).click();
  const changes = page.getByRole('table', { name: 'Field changes' }).first();
  await expect(changes.getByText(originalEmail)).toBeVisible();
  await expect(changes.getByText(newEmail)).toBeVisible();
  await signOut(page);

  // Put the original email back.
  await signIn(page, 'employee');
  await page.goto('/profile');
  await page.getByRole('textbox', { name: 'Email' }).fill(originalEmail);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
});

test('failed sign-ins show up in the audit log as denied', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Employee ID').fill(USERS.employee.id);
  await page.getByLabel('Password').fill('not-the-password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid employee ID or password')).toBeVisible();

  await signIn(page, 'admin');
  await page.goto('/audit');
  await page.getByRole('combobox', { name: 'Outcome' }).click();
  await page.getByRole('option', { name: 'Denied' }).click();
  const row = await newestAuditRow(page, `Failed sign-in for ${USERS.employee.id}`);
  await expect(row.getByText('Denied')).toBeVisible();
});
