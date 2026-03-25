import { test, expect } from '@playwright/test';

test('home loads with core messaging', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/FlowGuard/i);
  await expect(page.getByRole('heading', { name: /invisible slowdown/i })).toBeVisible();
  await expect(page.getByText(/Slack \+ Jira \+ GitHub/i).first()).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/playwright-home.png', fullPage: true });
});

test('click around and verify key sections', async ({ page }) => {
  await page.goto('/');

  await page.locator('nav').getByRole('link', { name: 'How It Works', exact: true }).click();
  await expect(page.getByRole('heading', { name: /A closed-loop operations co-pilot/i })).toBeVisible();

  await page.locator('nav').getByRole('link', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: /5 rules\. Ship first\./i })).toBeVisible();

  await page.locator('nav').getByRole('link', { name: 'Trust', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Built for trust/i })).toBeVisible();

  await page.getByText(/Free 7-day diagnostic/i).scrollIntoViewIfNeeded();
  await expect(page.getByText(/Free 7-day diagnostic/i)).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/playwright-click-around.png', fullPage: true });
});

test('digest preview shows actionable controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: 'Rules' }).click();
  await expect(page.getByRole('heading', { name: /Your morning briefing/i })).toBeVisible();
  await expect(page.getByText(/Decision Drift/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Decision Commit/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve Reminder/i })).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/playwright-digest-preview.png', fullPage: true });
});
