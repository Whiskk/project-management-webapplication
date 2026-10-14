import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Automated accessibility audit with axe-core against WCAG 2.0, 2.1 and 2.2 at
// levels A and AA: contrast, labels, names, roles, landmarks, list structure.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Wait for the page to finish loading, then fail with a readable list of any violations. */
async function expectAccessible(page, label) {
  // Loading placeholders are labelled "Loading ..."; real progress bars (budget, hours) stay.
  await expect(page.getByRole('progressbar', { name: /^Loading/ })).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`);
  expect(report, `Accessibility violations on ${label}`).toEqual([]);
}

/** Open a page from the address bar and audit it once its heading is shown. */
async function auditPage(page, path, heading) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await expectAccessible(page, path);
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  test('sign-in page, including validation errors', async ({ page }) => {
    await page.goto('/login');
    await expectAccessible(page, 'sign-in');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Employee ID is required')).toBeVisible();
    await expectAccessible(page, 'sign-in with errors');
  });

  test('admin pages and dialogs', async ({ page }) => {
    await signIn(page, 'admin');
    await expectAccessible(page, 'admin dashboard');
    await auditPage(page, '/projects', 'Projects');
    await auditPage(page, '/users', 'Users');
    await auditPage(page, '/requests', 'Project requests');
    await auditPage(page, '/profile', 'My profile');

    await auditPage(page, '/audit', 'Audit log');
    await page.getByRole('button', { name: 'Show details' }).first().click();
    await expectAccessible(page, 'audit log with an entry expanded');

    await page.goto('/projects');
    await page.getByRole('table', { name: 'Projects' }).getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expectAccessible(page, 'project detail');

    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    await expectAccessible(page, 'new project dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('dialog').getByText('Project name is required')).toBeVisible();
    await expectAccessible(page, 'new project dialog with errors');

    await page.goto('/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await expectAccessible(page, 'new user dialog');
  });

  test('manager pages and dialogs', async ({ page }) => {
    await signIn(page, 'manager');
    await expectAccessible(page, 'manager dashboard');
    await auditPage(page, '/projects', 'My projects');
    await auditPage(page, '/approvals', 'Approvals');
    await auditPage(page, '/requests', 'Project requests');
    await page.getByRole('button', { name: 'New request' }).click();
    await expectAccessible(page, 'new request dialog');
  });

  test('employee pages', async ({ page }) => {
    await signIn(page, 'employee');
    await expectAccessible(page, 'employee dashboard');
    await auditPage(page, '/projects', /projects/i);
    await auditPage(page, '/profile', 'My profile');
  });

  test('phone layout with the navigation menu open @mobile', async ({ page }) => {
    await page.goto('/login');
    await expectAccessible(page, 'sign-in on a phone');
    await signIn(page, 'manager');
    await expectAccessible(page, 'dashboard on a phone');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expectAccessible(page, 'navigation menu on a phone');
  });
});
