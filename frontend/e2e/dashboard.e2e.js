import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('an admin runs the budget monitor on demand from the dashboard', async ({ page }) => {
  await signIn(page, 'admin');
  await expect(page.getByText('Budget committed')).toBeVisible();
  await page.getByRole('button', { name: 'Run budget check now' }).click();
  await expect(page.getByText(/^Budget check (complete|found changes)/)).toBeVisible();
});

test('dashboard tiles link through to the matching pages', async ({ page }) => {
  await signIn(page, 'manager');
  await page.getByRole('link', { name: /My projects/ }).first().click();
  await expect(page.getByRole('heading', { name: 'My projects' })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('link', { name: /Approvals waiting/ }).click();
  await expect(page).toHaveURL(/\/approvals$/);
});
