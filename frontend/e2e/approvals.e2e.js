import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

test('cross-team hours need the employee\'s own manager to approve', async ({ page }) => {
  const name = unique('Cross-team');

  // The admin is not Eli's manager, so staffing Eli creates a request.
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, { start: '2032-04-05', end: '2032-04-16' });
  await page.getByRole('button', { name: 'Assign' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await expect(dialog.getByText(/reports to Morgan Manager, so these hours need their approval/)).toBeVisible();
  await dialog.getByLabel('Hours per week').fill('6');
  await dialog.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Awaiting Morgan Manager')).toBeVisible();
  await signOut(page);

  // Morgan approves it from the Approvals page.
  await signIn(page, 'manager');
  await page.goto('/approvals');
  const request = page.getByRole('article', { name: `Request for Eli Employee on ${name}` });
  await expect(request.getByText('6 h per week (new assignment)')).toBeVisible();
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(`Approved Eli Employee on ${name}`)).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.getByText('Awaiting Morgan Manager')).toHaveCount(0);
  await signOut(page);

  // The approval is in the audit log with who decided it.
  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await expect(page.getByText(`Approved 6 h/week for Eli Employee on ${name}`)).toBeVisible();
  await archiveCurrentProject(page);
});
