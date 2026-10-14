import { expect, test } from '@playwright/test';

test.describe('API reference', () => {
  test('/api-docs shows the OpenAPI spec and can call the live API', async ({ page }) => {
    await page.goto('/api-docs');
    await expect(page).toHaveURL(/\/api-docs\.html$/);
    await expect(page.getByRole('heading', { name: /Project Hub API/ })).toBeVisible();

    // Every service has a section, and "Try it out" really calls the API this site is served with.
    await expect(page.locator('#operations-tag-Tasks')).toBeVisible();
    const health = page.locator('#operations-Health-getHealth');
    await health.locator('.opblock-summary').click();
    await health.getByRole('button', { name: 'Try it out' }).click();
    await health.getByRole('button', { name: 'Execute' }).click();
    await expect(health.locator('.live-responses-table tr.response .response-col_status')).toHaveText('200');
    await expect(health.locator('.live-responses-table')).toContainText('"database": "ok"');
  });

  test('the raw spec is downloadable', async ({ request }) => {
    const response = await request.get('/openapi.yaml');
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain('openapi: 3.0.3');
  });
});
