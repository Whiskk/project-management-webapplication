import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

// A fortnight far ahead that no other test (or real work) books, so Eli always has hours free.
const PROJECT = { start: '2033-05-09', end: '2033-05-20' };

/** Booked hours in Eli's cell for the week of 9 May 2033 (the first column, opened by URL). */
async function eliBookedThatWeek(page) {
  await page.goto(`/availability?start=${PROJECT.start}`);
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: /May 9/ })).toBeVisible({ timeout: 30_000 });
  const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Eli Employee/ }) });
  const [, booked] = (await row.getByRole('cell').first().textContent()).match(/([\d.]+) h booked/);
  return Number(booked);
}

test('managers see who is free, staffing shows up there, and the employee is told', async ({ page }) => {
  const name = unique('Planning');
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, PROJECT);
  // Admins see how the budget figure is worked out.
  await page.getByRole('button', { name: 'About projected labour cost' }).click();
  await expect(page.getByRole('dialog', { name: 'Projected labour cost' })).toContainText('annual salary ÷ 2,080');
  await page.keyboard.press('Escape');
  await signOut(page);

  await signIn(page, 'manager');
  await page.getByRole('link', { name: 'Availability' }).click();
  await expect(page.getByRole('heading', { name: 'Team availability', level: 1 })).toBeVisible();
  const before = await eliBookedThatWeek(page);

  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Assign' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await assign.getByLabel('Hours per week').fill('3');
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByRole('table', { name: 'Team' }).getByText('Eli Employee')).toBeVisible();

  expect(await eliBookedThatWeek(page)).toBe(before + 3);
  await signOut(page);

  // Eli's dashboard says what changed, in plain words.
  await signIn(page, 'employee');
  const whatsNew = page.getByRole('list', { name: "What's new" });
  await expect(whatsNew.getByText(`Morgan Manager added you to ${name} for 3 h/week`)).toBeVisible();
  await expect(whatsNew.getByRole('link', { name: `Open ${name}` }).first()).toHaveAttribute('href', new URL(projectUrl).pathname);
  await signOut(page);

  await signIn(page, 'admin');
  await page.goto(projectUrl);
  await archiveCurrentProject(page);
});

test('admins export the filtered audit log as a CSV file', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/audit');
  await page.getByRole('combobox', { name: /^Action/ }).click();
  await page.getByRole('option', { name: 'auth.login', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV (filtered)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await fs.readFile(await download.path(), 'utf8')).trim().split('\n');
  expect(lines[0]).toBe('Time (UTC),Employee ID,Name,Role,Action,Outcome,Record type,Record ID,Project,Summary,Changes');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).every((line) => line.includes(',auth.login,'))).toBe(true);
  await expect(page.getByText(/^Exported (the newest )?[\d,]+/)).toBeVisible();
});
