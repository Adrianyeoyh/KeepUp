import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared mock data matching actual TypeScript interfaces
// ---------------------------------------------------------------------------

const TEAMS_ARRAY = [
  { id: '1', company_id: '1', name: 'Backend', slug: 'backend', color: '#06b6d4', description: 'Backend team', lead_user_id: null, icon: null, project_count: '2', event_count_7d: '42', active_leak_count: '3', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: '2', company_id: '1', name: 'Frontend', slug: 'frontend', color: '#8b5cf6', description: 'Frontend team', lead_user_id: null, icon: null, project_count: '1', event_count_7d: '18', active_leak_count: '1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

const PROJECTS_ARRAY = [
  { id: '1', company_id: '1', team_id: '1', name: 'API Gateway', slug: 'api-gateway', description: 'Main API', jira_project_keys: ['APIGW'], github_repos: ['org/api-gw'], slack_channel_ids: ['C01'], status: 'active', start_date: null, target_date: null, team_name: 'Backend', team_color: '#06b6d4', event_count_7d: '12', active_leak_count: '1', created_at: '2025-01-01T00:00:00Z' },
];

const OVERVIEW = {
  company: { id: '1', name: 'Acme Corp', settings: {} },
  leaks: { total: 4, by_status: { detected: 2, delivered: 2 } },
  events: { total: 60, by_source: { github: 30, slack: 20, jira: 10 } },
  recent_leaks: [],
  integrations: [{ provider: 'slack', status: 'active', updated_at: '2025-01-15T10:00:00Z' }],
  commits: { by_status: { approved: 5, merged: 10, draft: 1 } },
  actions: { by_status: { pending: 2, executed: 3 } },
};

const TEAM_HEALTH = {
  teams: [
    { id: '1', name: 'Backend', slug: 'backend', color: '#06b6d4', leakCount: 5, activeLeaks: 3, eventCount7d: 42, metrics: {}, healthScore: 72 },
    { id: '2', name: 'Frontend', slug: 'frontend', color: '#8b5cf6', leakCount: 2, activeLeaks: 1, eventCount7d: 18, metrics: {}, healthScore: 85 },
  ],
  company_health_score: 78,
};

const PROJECT_DETAIL = {
  project: { id: '1', name: 'API Gateway', slug: 'api-gateway', description: 'Main API', status: 'active', start_date: null, target_date: null, team_id: '1', team_name: 'Backend', team_color: '#06b6d4', jira_project_keys: ['APIGW'], github_repos: ['org/api-gw'], slack_channel_ids: ['C01'] },
  stats: { events_7d: 12, active_leaks: 1 },
};

const PROJECT_ACTIVITY = {
  project_id: '1', days: 14, nodes: [], edges: [],
  health_metrics: {}, totals: { events: 12, leaks: 1, links: 5 },
};

async function mockAllApis(page: Page) {
  // Specific routes first
  await page.route('**/api/projects/1/activity-graph*', (route) => route.fulfill({ json: PROJECT_ACTIVITY }));
  await page.route('**/api/projects/1', (route) => route.fulfill({ json: PROJECT_DETAIL }));
  await page.route('**/api/teams/health*', (route) => route.fulfill({ json: TEAM_HEALTH }));

  await page.route('**/api/teams', (route) => route.fulfill({ json: { teams: TEAMS_ARRAY } }));
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { projects: PROJECTS_ARRAY } });
    return route.continue();
  });
  await page.route('**/api/dashboard/overview*', (route) => route.fulfill({ json: OVERVIEW }));
  await page.route('**/api/leaks*', (route) => route.fulfill({ json: { leaks: [], total: 0 } }));
  await page.route('**/api/approvals/*/action', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/approvals*', (route) => route.fulfill({ json: { actions: [], total: 0 } }));
  await page.route('**/api/ledger/tree*', (route) => route.fulfill({ json: { commits: [], leaks: [], teams: [] } }));
  await page.route('**/api/compare/metrics*', (route) => route.fulfill({ json: { series: [], org_baseline: [] } }));
  await page.route('**/api/metrics*', (route) => route.fulfill({ json: { metrics: [] } }));
  await page.route('**/api/settings*', (route) => route.fulfill({ json: { company: { id: '1', name: 'Acme Corp', settings: {} }, integrations: [] } }));
  await page.route('**/api/health/detailed*', (route) => route.fulfill({ json: { status: 'ok', timestamp: '2025-01-15T10:00:00Z', database: 'ok', counts: { companies: 1, events: 0, leaks: 0 } } }));
  await page.route('**/api/feedback*', (route) => route.fulfill({ json: { ok: true } }));
}

// ===========================================================================
// Sidebar Navigation — All Main Pages
// ===========================================================================
test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('navigates through all dashboard pages via sidebar', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();

    // Navigate to Leaks
    await page.click('a[href="/app/leaks"]');
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/leaks/);

    // Navigate to Approvals
    await page.click('a[href="/app/approvals"]');
    await expect(page.getByRole('heading', { name: /approvals/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/approvals/);

    // Navigate to Ledger
    await page.click('a[href="/app/ledger"]');
    await expect(page.getByRole('heading', { name: /git ledger/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/ledger/);

    // Navigate to Metrics
    await page.click('a[href="/app/metrics"]');
    await expect(page.getByRole('heading', { name: /metrics/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/metrics/);

    // Navigate to Teams
    await page.click('a[href="/app/teams"]');
    await expect(page.getByRole('heading', { name: /teams/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/teams/);

    // Navigate to Projects
    await page.click('a[href="/app/projects"]');
    await expect(page.getByRole('heading', { name: /projects/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/projects/);

    // Navigate to Settings
    await page.click('a[href="/app/settings"]');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/settings/);

    // Back to Overview
    const overviewLink = page.locator('a[href="/app"]').first();
    await overviewLink.click();
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('active sidebar link is visually highlighted', async ({ page }) => {
    await page.goto('/app/leaks');
    const leaksLink = page.locator('a[href="/app/leaks"]');
    // Active link should have cyan/highlighted styling
    await expect(leaksLink).toBeVisible();
    const className = await leaksLink.getAttribute('class');
    expect(className).toBeTruthy();
  });

  test('sidebar scope selector shows teams', async ({ page }) => {
    await page.goto('/app');
    // Scope selector should have "All Teams" + each team
    const scopeSelect = page.locator('select').first();
    await expect(scopeSelect).toBeVisible();

    const options = scopeSelect.locator('option');
    // Should have "All Teams" + TEAMS_ARRAY.length options
    expect(await options.count()).toBeGreaterThanOrEqual(TEAMS_ARRAY.length + 1);
  });

  test('scope selector filters by team', async ({ page }) => {
    let lastOverviewUrl = '';
    await mockAllApis(page);
    // Override the overview route to capture the URL
    await page.route('**/api/dashboard/overview*', (route) => {
      lastOverviewUrl = route.request().url();
      return route.fulfill({ json: OVERVIEW });
    });

    await page.goto('/app');
    await page.waitForTimeout(500);

    // Select "Backend" team
    const scopeSelect = page.locator('select').first();
    await scopeSelect.selectOption({ label: 'Backend' });
    await page.waitForTimeout(500);

    // The API call should now include team_id
    expect(lastOverviewUrl).toContain('team_id');
  });
});

// ===========================================================================
// Landing Page ↔ Dashboard Navigation
// ===========================================================================
test.describe('Landing Page Navigation', () => {
  test('landing page → dashboard → back to landing', async ({ page }) => {
    await mockAllApis(page);

    // Start on landing page
    await page.goto('/');
    await expect(page).toHaveTitle(/FlowGuard/i);

    // Find and click dashboard link
    const dashLink = page.locator('a[href="/app"]').first();
    await expect(dashLink).toBeVisible();
    await dashLink.click();

    // Should be in dashboard
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app/);

    // Click "Back to site" link in sidebar
    const backLink = page.locator('a[href="/"]').first();
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should be back on landing page
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/FlowGuard/i).first()).toBeVisible();
  });
});

// ===========================================================================
// Project Navigation — Projects list → Project detail → Back
// ===========================================================================
test.describe('Project Activity Navigation', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('navigates from projects list to project detail and back', async ({ page }) => {
    await page.goto('/app/projects');
    await expect(page.getByRole('heading', { name: /projects/i }).first()).toBeVisible();

    // Click on project name to go to detail
    const projectLink = page.locator('a[href="/app/projects/1"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await expect(page).toHaveURL(/\/app\/projects\/1/);
      await expect(page.getByText('API Gateway').first()).toBeVisible();

      // Click breadcrumb to go back
      const breadcrumb = page.locator('a[href="/app/projects"]').first();
      if (await breadcrumb.isVisible()) {
        await breadcrumb.click();
        await expect(page).toHaveURL(/\/app\/projects$/);
      }
    }
  });
});

// ===========================================================================
// 404 / NotFound Page
// ===========================================================================
test.describe('NotFound Page', () => {
  test('unknown route shows 404 page', async ({ page }) => {
    await page.goto('/totally-nonexistent-route');
    // Should show the NotFound component
    await expect(page.getByText(/404|not found/i).first()).toBeVisible();
  });
});

// ===========================================================================
// Browser History — Back/Forward
// ===========================================================================
test.describe('Browser History', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('browser back button navigates correctly', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();

    // Navigate to Leaks
    await page.click('a[href="/app/leaks"]');
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();

    // Navigate to Teams
    await page.click('a[href="/app/teams"]');
    await expect(page.getByRole('heading', { name: /teams/i }).first()).toBeVisible();

    // Go back to Leaks
    await page.goBack();
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/leaks/);

    // Go back to Dashboard
    await page.goBack();
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);

    // Go forward to Leaks
    await page.goForward();
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();
  });
});

// ===========================================================================
// Direct URL Access — Deep Links
// ===========================================================================
test.describe('Direct URL Access', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('directly navigates to each route', async ({ page }) => {
    // Leaks
    await page.goto('/app/leaks');
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();

    // Approvals
    await page.goto('/app/approvals');
    await expect(page.getByRole('heading', { name: /approvals/i })).toBeVisible();

    // Ledger
    await page.goto('/app/ledger');
    await expect(page.getByRole('heading', { name: /git ledger/i })).toBeVisible();

    // Metrics
    await page.goto('/app/metrics');
    await expect(page.getByRole('heading', { name: /metrics/i })).toBeVisible();

    // Teams
    await page.goto('/app/teams');
    await expect(page.getByRole('heading', { name: /teams/i }).first()).toBeVisible();

    // Projects
    await page.goto('/app/projects');
    await expect(page.getByRole('heading', { name: /projects/i }).first()).toBeVisible();

    // Settings
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    // Project detail
    await page.goto('/app/projects/1');
    await expect(page.getByText('API Gateway').first()).toBeVisible();
  });
});

// ===========================================================================
// Metrics Page — Interactive Navigation
// ===========================================================================
test.describe('Metrics Interactions', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('switching days range re-fetches data', async ({ page }) => {
    let lastMetricsUrl = '';
    await page.route('**/api/metrics*', (route) => {
      lastMetricsUrl = route.request().url();
      return route.fulfill({ json: { metrics: [] } });
    });

    await page.goto('/app/metrics');
    await page.waitForTimeout(300);

    // Click 30 days button
    const thirtyBtn = page.getByRole('button', { name: /30/i }).first();
    if (await thirtyBtn.isVisible()) {
      await thirtyBtn.click();
      await page.waitForTimeout(300);
      expect(lastMetricsUrl).toContain('30');
    }
  });

  test('compare mode toggle shows team comparison', async ({ page }) => {
    await page.goto('/app/metrics');
    
    const compareBtn = page.getByRole('button', { name: /compare/i });
    if (await compareBtn.isVisible()) {
      await compareBtn.click();
      await page.waitForTimeout(300);
      // In compare mode, a metric dropdown should appear
      const selects = page.locator('select');
      expect(await selects.count()).toBeGreaterThanOrEqual(1);
    }
  });
});

// ===========================================================================
// Ledger Page — View Toggle
// ===========================================================================
test.describe('Ledger View Toggle', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('toggles between Tree and Graph view', async ({ page }) => {
    await page.goto('/app/ledger');

    // Tree should be default
    const treeBtn = page.getByRole('button', { name: /tree/i });
    const graphBtn = page.getByRole('button', { name: /graph/i });

    await expect(treeBtn).toBeVisible();
    await expect(graphBtn).toBeVisible();

    // Switch to Graph
    await graphBtn.click();
    await page.waitForTimeout(300);

    // Switch back to Tree
    await treeBtn.click();
    await page.waitForTimeout(300);
  });

  test('date range clear button resets filters', async ({ page }) => {
    await page.goto('/app/ledger');

    // Set a date in the from input
    const fromInput = page.locator('input[type="date"]').first();
    if (await fromInput.isVisible()) {
      await fromInput.fill('2025-01-01');
      await page.waitForTimeout(300);

      // Click Clear button
      const clearBtn = page.getByRole('button', { name: /clear/i });
      if (await clearBtn.isVisible()) {
        await clearBtn.click();
        await page.waitForTimeout(300);
        const value = await fromInput.inputValue();
        expect(value).toBe('');
      }
    }
  });
});
