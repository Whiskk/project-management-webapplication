import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, unique } from './helpers';

test('archived projects are kept read-only and can be reactivated', async ({ page }) => {
  const name = unique('Archive me');
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name);

  // Archiving hides editing but keeps every record.
  await archiveCurrentProject(page);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Assign' })).toHaveCount(0);

  // It drops out of the default list, and shows under "Archived".
  await page.goto('/projects');
  await page.getByLabel('Search').fill(name);
  const table = page.getByRole('table', { name: 'Projects' });
  await expect(table.getByText('No projects match your filters.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'Archived' }).click();
  await table.getByRole('link', { name }).click();
  await expect(page).toHaveURL(projectUrl);

  // Reactivate: editable again.
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText(`${name} reactivated`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

  await archiveCurrentProject(page);
});
