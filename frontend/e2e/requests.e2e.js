import { expect, test } from '@playwright/test';
import { archiveCurrentProject, signIn, signOut, unique } from './helpers';

/** Manager: submit a project request through the form. */
async function submitRequest(page, name) {
  await page.goto('/requests');
  await page.getByRole('button', { name: 'New request' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Start date').fill('2032-05-03');
  await dialog.getByLabel('Predicted end date').fill('2032-05-28');
  await dialog.getByLabel('Budget').fill('75000');
  await dialog.getByLabel('Justification').fill('Customers keep asking for it.');
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText(`Request for '${name}' sent to the admins`)).toBeVisible();
  const card = page.getByRole('article', { name: `Request for ${name}` });
  await expect(card.getByText('Pending')).toBeVisible();
}

test('a manager requests a project and an admin approves it into a real project', async ({ page }) => {
  const name = unique('Requested');

  await signIn(page, 'manager');
  await submitRequest(page, name);
  await signOut(page);

  // The admin reviews it from the Requests page and approves.
  await signIn(page, 'admin');
  await page.goto('/requests');
  const card = page.getByRole('article', { name: `Request for ${name}` });
  await expect(card.getByText('Requested by Morgan Manager')).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve and create project' }).click();
  await expect(page.getByText(`Approved - project '${name}' created`)).toBeVisible();
  await signOut(page);

  // The manager sees the decision and opens the new project, which they manage.
  await signIn(page, 'manager');
  await page.goto('/requests');
  const approved = page.getByRole('article', { name: `Request for ${name}` });
  await expect(approved.getByText('Approved by Alex Admin')).toBeVisible();
  await approved.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Managed by Morgan Manager')).toBeVisible();
  const projectUrl = page.url();
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});

test('an admin must give a reason to reject a request, and the manager sees it', async ({ page }) => {
  const name = unique('Rejected');

  await signIn(page, 'manager');
  await submitRequest(page, name);
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto('/requests');
  await page.getByRole('article', { name: `Request for ${name}` }).getByRole('button', { name: 'Reject' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reject request' }).click();
  await expect(dialog.getByText('Give a reason so the manager knows why')).toBeVisible();
  await dialog.getByLabel('Reason').fill('No budget left this quarter.');
  await dialog.getByRole('button', { name: 'Reject request' }).click();
  await expect(page.getByText('Request rejected')).toBeVisible();
  await signOut(page);

  await signIn(page, 'manager');
  await page.goto('/requests');
  const card = page.getByRole('article', { name: `Request for ${name}` });
  await expect(card.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(card.getByText('Alex Admin: No budget left this quarter.')).toBeVisible();
});
