import { expect, test } from '@playwright/test';
import { signIn, signOut, unknownEmployeeId } from './helpers';

test.describe('sign-in and access control', () => {
  test('each role lands on its own dashboard', async ({ page }) => {
    await signIn(page, 'admin');
    await expect(page.getByText('Requests to review')).toBeVisible();
    await signOut(page);

    await signIn(page, 'manager');
    await expect(page.getByText('My team this week')).toBeVisible();
    await signOut(page);

    await signIn(page, 'employee');
    await expect(page.getByText('My week')).toBeVisible();
  });

  test('a wrong password is refused with a clear message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Employee ID').fill(unknownEmployeeId());
    await page.getByLabel('Password').fill('wrong!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid employee ID or password')).toBeVisible();
  });

  test('employees cannot reach admin pages, even by URL', async ({ page }) => {
    await signIn(page, 'employee');
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('signed-out visitors are sent to sign in', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('mobile layout uses a slide-out menu @mobile', async ({ page }) => {
    await signIn(page, 'manager');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { name: 'My projects' })).toBeVisible();
  });
});
