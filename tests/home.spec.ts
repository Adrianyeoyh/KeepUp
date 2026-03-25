import { test, expect } from '@playwright/test';

test('home loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/FlowGuard/i);
  await expect(page.getByRole('heading', { name: /invisible slowdown/i })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/playwright-home-basic.png', fullPage: true });
});
