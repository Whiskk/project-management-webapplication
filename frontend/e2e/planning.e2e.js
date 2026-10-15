import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { archiveCurrentProject, createProject, signIn, signOut, unique } from './helpers';

const iso = (date) => date.toISOString().slice(0, 10);
const daysFromNow = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};
/** Next week's Monday, as the availability table labels it ("Nov 2"). */
function nextMondayLabel() {
  const date = new Date();
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Booked hours in Eli's "next week" cell of the availability table. */
async function eliBookedNextWeek(page) {
  await page.goto('/availability');
  const table = page.getByRole('table');
  const column = await table.getByRole('columnheader').allTextContents();
  const index = column.findIndex((text) => text.includes(nextMondayLabel()));
  expect(index, 'next week is a column').toBeGreaterThan(0);
  const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Eli Employee/ }) });
  const cell = row.getByRole('cell').nth(index - 1);
  const [, booked] = (await cell.textContent()).match(/([\d.]+) h booked/);
  return Number(booked);
}

test('managers see who is free, staffing shows up there, and the employee is told', async ({ page }) => {
  const name = unique('Planning');
  // Today to two weeks out, so next week (Monday to Friday) is fully inside the project.
  await signIn(page, 'admin');
  const projectUrl = await createProject(page, name, { start: iso(daysFromNow(0)), end: iso(daysFromNow(13)) });
  // Admins see how the budget figure is worked out.
  await page.getByRole('button', { name: 'About projected labour cost' }).click();
  await expect(page.getByRole('dialog', { name: 'Projected labour cost' })).toContainText('annual salary ÷ 2,080');
  await page.keyboard.press('Escape');
  await signOut(page);

  await signIn(page, 'manager');
  await page.getByRole('link', { name: 'Availability' }).click();
  await expect(page.getByRole('heading', { name: 'Team availability', level: 1 })).toBeVisible();
  const before = await eliBookedNextWeek(page);

  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Assign' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByRole('combobox', { name: /Employee/ }).click();
  await page.getByRole('option', { name: /Eli Employee/ }).click();
  await assign.getByLabel('Hours per week').fill('3');
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByRole('table', { name: 'Team' }).getByText('Eli Employee')).toBeVisible();

  expect(await eliBookedNextWeek(page)).toBe(before + 3);
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
