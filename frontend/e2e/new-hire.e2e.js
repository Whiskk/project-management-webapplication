import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

test('a new hire must choose their own password at first sign-in', async ({ page }) => {
  const lastName = `Newhire${Date.now().toString(36)}`;

  // Admin creates the account; the ID and temporary password are shown once.
  await signIn(page, 'admin');
  await page.goto('/users');
  await page.getByRole('button', { name: 'New user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('First name').fill('E2E');
  await form.getByLabel('Last name').fill(lastName);
  await form.getByLabel('Email').fill(`${lastName.toLowerCase()}@example.com`);
  await form.getByLabel('Annual salary').fill('50000');
  await form.getByRole('combobox', { name: /^Manager/ }).click();
  await page.getByRole('option', { name: /Morgan Manager/ }).click();
  await form.getByRole('button', { name: 'Create user' }).click();

  const credentials = page.getByRole('dialog', { name: 'User created' });
  const details = await credentials.textContent();
  const employeeId = details.match(/Employee ID: ([A-Z0-9]{6})/)[1];
  const temporary = await credentials.getByTestId('temporary-password').textContent();
  expect(employeeId).toMatch(/^EN[A-Z2-9]{4}$/); // initials of "E2E Newhire..." + 4 characters
  await credentials.getByRole('button', { name: 'Done' }).click();
  await signOut(page);

  // The new hire signs in and is held on the change-password page.
  await page.getByLabel('Employee ID').fill(employeeId);
  await page.getByLabel('Password').fill(temporary);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

  await page.getByLabel('Temporary password').fill(temporary);
  await page.getByLabel(/^New password/).fill('Sunny2026x');
  await page.getByLabel('Confirm new password').fill('Sunny2026x');
  await page.getByRole('button', { name: 'Set password and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('My week')).toBeVisible();
  await signOut(page);

  // Cleanup: users are never deleted, so deactivate the test account.
  await signIn(page, 'admin');
  await page.goto('/users');
  await page.getByLabel('Search').fill(lastName);
  // Wait for the (debounced) search to settle on just this user before opening its menu.
  await expect(page.getByRole('table', { name: 'Users' }).getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: `Actions for E2E ${lastName}` }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText(`E2E ${lastName} deactivated`)).toBeVisible();
});
