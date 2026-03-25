import { test, expect } from '@playwright/test';

test.describe('Dashboard /app routes', () => {
  test('dashboard overview loads with sidebar navigation', async ({ page }) => {
    await page.goto('/app');

    // Sidebar brand
    await expect(page.locator('text=FlowGuard').first()).toBeVisible();

    // Navigation items
    await expect(page.locator('a[href="/app"]').first()).toBeVisible();
    await expect(page.locator('a[href="/app/leaks"]')).toBeVisible();
    await expect(page.locator('a[href="/app/approvals"]')).toBeVisible();
    await expect(page.locator('a[href="/app/ledger"]')).toBeVisible();
    await expect(page.locator('a[href="/app/metrics"]')).toBeVisible();
    await expect(page.locator('a[href="/app/settings"]')).toBeVisible();

    // Page heading
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('leaks page renders with filter controls', async ({ page }) => {
    await page.goto('/app/leaks');
    await expect(page.getByRole('heading', { name: 'Leaks' })).toBeVisible();

    // Filter dropdowns present
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
  });

  test('approvals page renders', async ({ page }) => {
    await page.goto('/app/approvals');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  });

  test('ledger page renders', async ({ page }) => {
    await page.goto('/app/ledger');
    await expect(page.getByRole('heading', { name: 'Git Ledger' })).toBeVisible();
  });

  test('metrics page renders', async ({ page }) => {
    await page.goto('/app/metrics');
    await expect(page.getByRole('heading', { name: 'Metrics' })).toBeVisible();
  });

  test('settings page renders', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('sidebar navigation works between pages', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Navigate to Leaks
    await page.click('a[href="/app/leaks"]');
    await expect(page.getByRole('heading', { name: 'Leaks' })).toBeVisible();

    // Navigate to Approvals
    await page.click('a[href="/app/approvals"]');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();

    // Navigate to Ledger
    await page.click('a[href="/app/ledger"]');
    await expect(page.getByRole('heading', { name: 'Git Ledger' })).toBeVisible();

    // Navigate to Metrics
    await page.click('a[href="/app/metrics"]');
    await expect(page.getByRole('heading', { name: 'Metrics' })).toBeVisible();

    // Navigate to Settings
    await page.click('a[href="/app/settings"]');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Back to overview
    await page.click('a[href="/app"]');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('back-to-site link returns to landing page', async ({ page }) => {
    await page.goto('/app');
    const backLink = page.locator('a[href="/"]').first();
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should see the landing page hero
    await expect(page.locator('text=FlowGuard').first()).toBeVisible();
  });

  test('landing page has dashboard link', async ({ page }) => {
    await page.goto('/');
    const dashLink = page.locator('a[href="/app"]').first();
    await expect(dashLink).toBeVisible();
    await dashLink.click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
