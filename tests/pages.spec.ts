import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock data matching actual TypeScript interfaces in each page component
// ---------------------------------------------------------------------------

const TEAMS_ARRAY = [
  { id: '1', company_id: '1', name: 'Backend', slug: 'backend', color: '#06b6d4', description: 'Backend team', lead_user_id: null, icon: null, project_count: '2', event_count_7d: '42', active_leak_count: '3', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: '2', company_id: '1', name: 'Frontend', slug: 'frontend', color: '#8b5cf6', description: 'Frontend team', lead_user_id: null, icon: null, project_count: '1', event_count_7d: '18', active_leak_count: '1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

const PROJECTS_ARRAY = [
  { id: '1', company_id: '1', team_id: '1', name: 'API Gateway', slug: 'api-gateway', description: 'Main API', jira_project_keys: ['APIGW'], github_repos: ['org/api-gw'], slack_channel_ids: ['C01'], status: 'active', start_date: null, target_date: null, team_name: 'Backend', team_color: '#06b6d4', event_count_7d: '12', active_leak_count: '1', created_at: '2025-01-01T00:00:00Z' },
  { id: '2', company_id: '1', team_id: '2', name: 'Dashboard', slug: 'dashboard', description: 'Dashboard app', jira_project_keys: ['DASH'], github_repos: [], slack_channel_ids: [], status: 'active', start_date: null, target_date: '2025-06-01', team_name: 'Frontend', team_color: '#8b5cf6', event_count_7d: '5', active_leak_count: '0', created_at: '2025-01-01T00:00:00Z' },
];

// DashboardData — matches DashboardOverview.tsx interface
const OVERVIEW = {
  company: { id: '1', name: 'Acme Corp', settings: {} },
  leaks: { total: 4, by_status: { detected: 2, delivered: 2 } },
  events: { total: 60, by_source: { github: 30, slack: 20, jira: 10 } },
  recent_leaks: [
    { id: '1', leak_type: 'decision_drift', severity: 70, confidence: 0.87, status: 'detected', detected_at: '2025-01-15T10:00:00Z', cost_estimate_hours_per_week: 3, evidence_links: [{ title: 'PR #42', url: 'https://example.com' }], metrics_context: { current_value: 4.2, baseline_value: 3.0, metric_name: 'jira.cycle_time_median', delta_percentage: 40 }, ai_diagnosis: { root_cause: 'Missing approval flow', explanation: 'Config changed without ticket' } },
  ],
  integrations: [
    { provider: 'slack', status: 'active', updated_at: '2025-01-15T10:00:00Z' },
    { provider: 'jira', status: 'active', updated_at: '2025-01-14T08:00:00Z' },
    { provider: 'github', status: 'inactive', updated_at: null },
  ],
  commits: { by_status: { approved: 5, merged: 10, draft: 1 } },
  actions: { by_status: { pending: 2, executed: 3 } },
};

// TeamHealthData — matches DashboardOverview.tsx interface
const TEAM_HEALTH = {
  teams: [
    { id: '1', name: 'Backend', slug: 'backend', color: '#06b6d4', leakCount: 5, activeLeaks: 3, eventCount7d: 42, metrics: { 'jira.cycle_time_median': { value: 4.2, baseline: 3.0 }, 'github.pr_review_latency_median': { value: 18, baseline: 12 } }, healthScore: 72 },
    { id: '2', name: 'Frontend', slug: 'frontend', color: '#8b5cf6', leakCount: 2, activeLeaks: 1, eventCount7d: 18, metrics: { 'jira.cycle_time_median': { value: 2.1, baseline: 2.5 }, 'github.pr_review_latency_median': { value: 8, baseline: 10 } }, healthScore: 85 },
  ],
  company_health_score: 78,
};

// LeaksResponse — matches LeaksPage.tsx interface
const LEAKS = {
  leaks: [
    { id: '1', leak_type: 'decision_drift', severity: 70, confidence: 0.87, status: 'detected', detected_at: '2025-01-15T10:00:00Z', cost_estimate_hours_per_week: 3, evidence_links: [{ title: 'PR #42', url: 'https://example.com' }], metrics_context: { current_value: 4.2, baseline_value: 3.0, metric_name: 'jira.cycle_time_median', delta_percentage: 40, semantic_explanation: 'Decision made outside of process' }, ai_diagnosis: { root_cause: 'Missing approval', explanation: 'Config changed without ticket', suggested_actions: ['Create Jira ticket'] } },
  ],
  total: 1,
};

// ApprovalsResponse — matches ApprovalsPage.tsx interface
const APPROVALS = {
  actions: [
    { id: '1', action_type: 'create_jira_issue', target_system: 'jira', target_id: 'PROJ-1', preview_diff: { description: 'Create ticket for decision drift' }, risk_level: 'low', blast_radius: 'single_team', approval_status: 'pending', requested_by: 'system', approved_by: null, approved_at: null, created_at: '2025-01-15T10:00:00Z', leak_type: 'decision_drift', leak_severity: 70 },
    { id: '2', action_type: 'post_slack_message', target_system: 'slack', target_id: '#backend', preview_diff: { description: 'Notify about PR bottleneck' }, risk_level: 'low', blast_radius: 'single_team', approval_status: 'approved', requested_by: 'system', approved_by: 'user@acme.com', approved_at: '2025-01-14T09:00:00Z', created_at: '2025-01-14T08:00:00Z', leak_type: 'pr_review_bottleneck', leak_severity: 50 },
  ],
  total: 2,
};

// TreeResponse — matches LedgerPage.tsx interface
const LEDGER_TREE = {
  commits: [
    { id: '1', commit_type: 'decision', status: 'approved', summary: 'Adopt microservices', team_id: '1', team_name: 'Backend', created_at: '2025-01-15T10:00:00Z', parent_id: null },
    { id: '2', commit_type: 'action', status: 'merged', summary: 'Deploy new gateway', team_id: '1', team_name: 'Backend', created_at: '2025-01-14T09:00:00Z', parent_id: '1' },
  ],
  teams: TEAMS_ARRAY,
  leaks: [
    { id: '1', leak_type: 'decision_drift', severity: 70, status: 'detected', team_id: '1', team_name: 'Backend', detected_at: '2025-01-15T10:00:00Z' },
  ],
};

// MetricsResponse — matches MetricsPage.tsx interface
const METRICS = {
  metrics: [
    { date: '2025-01-15', metric_name: 'jira.cycle_time_median', value: 4.2 },
    { date: '2025-01-15', metric_name: 'github.pr_review_latency_median', value: 18 },
    { date: '2025-01-15', metric_name: 'slack.unresolved_threads', value: 3 },
    { date: '2025-01-14', metric_name: 'jira.cycle_time_median', value: 3.9 },
    { date: '2025-01-14', metric_name: 'github.pr_review_latency_median', value: 16 },
    { date: '2025-01-14', metric_name: 'slack.unresolved_threads', value: 2 },
  ],
};

// TeamCompareResponse — matches MetricsPage.tsx interface
const COMPARE_METRICS = {
  series: [
    { team_id: '1', team_name: 'Backend', team_color: '#06b6d4', series: [{ date: '2025-01-15', value: 4.2 }] },
    { team_id: '2', team_name: 'Frontend', team_color: '#8b5cf6', series: [{ date: '2025-01-15', value: 2.1 }] },
  ],
  org_baseline: [{ date: '2025-01-15', value: 3.15 }],
};

// SettingsData — matches SettingsPage.tsx interface
const SETTINGS = {
  company: { id: '1', name: 'Acme Corp', settings: { notifications: true } },
  integrations: [
    { id: '1', provider: 'slack', status: 'active', installation_data: { team_id: 'T01' }, scopes: ['chat:write'], updated_at: '2025-01-15T10:00:00Z' },
    { id: '2', provider: 'jira', status: 'active', installation_data: { project_count: 2 }, scopes: ['read:jira-work'], updated_at: '2025-01-14T08:00:00Z' },
    { id: '3', provider: 'github', status: 'inactive', installation_data: {}, scopes: [], updated_at: null },
  ],
};

// HealthData — matches SettingsPage.tsx interface
const HEALTH_DETAILED = {
  status: 'ok',
  timestamp: '2025-01-15T10:00:00Z',
  database: 'ok',
  counts: { companies: 1, events: 500, leaks: 20 },
};

// ProjectDetail + ActivityGraph — matches ProjectActivityPage.tsx interfaces
const PROJECT_DETAIL = {
  project: { id: '1', name: 'API Gateway', slug: 'api-gateway', description: 'Main API', status: 'active', start_date: null, target_date: null, team_id: '1', team_name: 'Backend', team_color: '#06b6d4', jira_project_keys: ['APIGW'], github_repos: ['org/api-gw'], slack_channel_ids: ['C01'] },
  stats: { events_7d: 12, active_leaks: 1 },
};

const PROJECT_ACTIVITY = {
  project_id: '1',
  days: 14,
  nodes: [
    { id: 'e1', type: 'event', source: 'github', summary: 'PR #42 merged', timestamp: '2025-01-15T10:00:00Z' },
    { id: 'l1', type: 'leak', leak_type: 'decision_drift', severity: 'high', summary: 'Config changed without ticket', timestamp: '2025-01-15T09:00:00Z' },
  ],
  edges: [
    { id: 'edge1', source: 'e1', target: 'l1', source_type: 'event', target_type: 'leak', link_type: 'caused', confidence: 0.85 },
  ],
  health_metrics: { 'jira.cycle_time_median': 4.2 },
  totals: { events: 12, leaks: 1, links: 5 },
};

// ---------------------------------------------------------------------------
// Utility: set up all API route mocks for a given page
// ---------------------------------------------------------------------------

async function mockAllApis(page: Page) {
  // IMPORTANT: Register more specific routes FIRST (Playwright matches in registration order)
  
  // Project-specific routes (before /api/projects)
  await page.route('**/api/projects/1/activity-graph*', (route) => route.fulfill({ json: PROJECT_ACTIVITY }));
  await page.route('**/api/projects/1', (route) => route.fulfill({ json: PROJECT_DETAIL }));
  
  // Teams health (before /api/teams)
  await page.route('**/api/teams/health*', (route) => route.fulfill({ json: TEAM_HEALTH }));
  
  // Teams
  await page.route('**/api/teams', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { teams: TEAMS_ARRAY } });
    return route.continue();
  });
  
  // Projects
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { projects: PROJECTS_ARRAY } });
    return route.continue();
  });
  
  // Dashboard
  await page.route('**/api/dashboard/overview*', (route) => route.fulfill({ json: OVERVIEW }));
  
  // Approvals action route (before generic /api/approvals*)
  await page.route('**/api/approvals/*/action', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/approvals*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: APPROVALS });
    return route.fulfill({ json: { ok: true } });
  });
  
  // Ledger
  await page.route('**/api/ledger/tree*', (route) => route.fulfill({ json: LEDGER_TREE }));
  
  // Compare metrics (before /api/metrics*)
  await page.route('**/api/compare/metrics*', (route) => route.fulfill({ json: COMPARE_METRICS }));
  await page.route('**/api/metrics*', (route) => route.fulfill({ json: METRICS }));
  
  // Leaks
  await page.route('**/api/leaks*', (route) => route.fulfill({ json: LEAKS }));
  
  // Settings + Health
  await page.route('**/api/health/detailed*', (route) => route.fulfill({ json: HEALTH_DETAILED }));
  await page.route('**/api/settings*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: SETTINGS });
    return route.fulfill({ json: { ok: true } });
  });
  
  // Feedback
  await page.route('**/api/feedback*', (route) => route.fulfill({ json: { ok: true } }));
}

// ===========================================================================
// 1. Dashboard Overview Page
// ===========================================================================
test.describe('Dashboard Overview', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and stat cards', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
    // Stat cards
    await expect(page.getByText('Active Leaks', { exact: true })).toBeVisible();
    await expect(page.getByText('Pending Approvals', { exact: true })).toBeVisible();
  });

  test('shows team health cards', async ({ page }) => {
    await page.goto('/app');
    // Team health section should show team comparison heading
    await expect(page.getByText('Team Comparison')).toBeVisible();
  });

  test('shows recent leaks section', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByText(/decision drift/i).first()).toBeVisible();
  });

  test('shows integration status', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByText(/slack/i).first()).toBeVisible();
    await expect(page.getByText(/jira/i).first()).toBeVisible();
    await expect(page.getByText(/github/i).first()).toBeVisible();
  });
});

// ===========================================================================
// 2. Leaks Page
// ===========================================================================
test.describe('Leaks Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and leak list', async ({ page }) => {
    await page.goto('/app/leaks');
    await expect(page.getByRole('heading', { name: /leaks/i })).toBeVisible();
    await expect(page.getByText(/golden rules violations/i)).toBeVisible();
  });

  test('has type and status filter dropdowns', async ({ page }) => {
    await page.goto('/app/leaks');
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
    // Should have at least 2 selects (type + status)
    expect(await selects.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays leak cards with details', async ({ page }) => {
    await page.goto('/app/leaks');
    // Leak cards are rendered inside Card components with font-medium span for type label
    await expect(page.locator('.font-medium').filter({ hasText: /Decision Drift/i }).first()).toBeVisible();
    // Status badge should be visible
    await expect(page.locator('[class*="border-amber"]').first()).toBeVisible();
  });

  test('type filter can be changed', async ({ page }) => {
    await page.goto('/app/leaks');
    await page.waitForTimeout(500);

    // The leak type filter is NOT the first select (the first is the sidebar scope selector)
    // Find the select within the main content area
    const allSelects = page.locator('select');
    const count = await allSelects.count();
    // Find the select that currently has value 'all' and contains leak type options
    for (let i = 0; i < count; i++) {
      const sel = allSelects.nth(i);
      const val = await sel.inputValue();
      if (val === 'all') {
        await sel.selectOption('decision_drift');
        const newVal = await sel.inputValue();
        expect(newVal).toBe('decision_drift');
        return;
      }
    }
  });
});

// ===========================================================================
// 3. Approvals Page
// ===========================================================================
test.describe('Approvals Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and action list', async ({ page }) => {
    await page.goto('/app/approvals');
    await expect(page.getByRole('heading', { name: /approvals/i })).toBeVisible();
    await expect(page.getByText(/review and approve/i)).toBeVisible();
  });

  test('shows action cards with status badges', async ({ page }) => {
    await page.goto('/app/approvals');
    // Should render action cards with status text
    await expect(page.getByText(/create.*jira|jira/i).first()).toBeVisible();
  });

  test('pending action has approve/reject buttons', async ({ page }) => {
    await page.goto('/app/approvals');
    // Should see Approve and Reject buttons for pending action
    const approveBtn = page.getByRole('button', { name: /approve/i }).first();
    const rejectBtn = page.getByRole('button', { name: /reject/i }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await expect(rejectBtn).toBeVisible();
  });

  test('has status filter dropdown', async ({ page }) => {
    await page.goto('/app/approvals');
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
  });
});

// ===========================================================================
// 4. Ledger Page
// ===========================================================================
test.describe('Ledger Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and subtitle', async ({ page }) => {
    await page.goto('/app/ledger');
    await expect(page.getByRole('heading', { name: /git ledger/i })).toBeVisible();
    await expect(page.getByText(/version control for decisions/i)).toBeVisible();
  });

  test('has type and status filter dropdowns', async ({ page }) => {
    await page.goto('/app/ledger');
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
    expect(await selects.count()).toBeGreaterThanOrEqual(2);
  });

  test('has date range inputs', async ({ page }) => {
    await page.goto('/app/ledger');
    // Date inputs are inside the expanded filter panel
    await page.getByRole('button', { name: /more/i }).click();
    const dateInputs = page.locator('input[type="date"]');
    expect(await dateInputs.count()).toBeGreaterThanOrEqual(2);
  });

  test('has view mode toggle (Tree / Graph)', async ({ page }) => {
    await page.goto('/app/ledger');
    await expect(page.getByRole('button', { name: /tree/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /graph/i })).toBeVisible();
  });

  test('displays commit stats', async ({ page }) => {
    await page.goto('/app/ledger');
    // Stats should show commit and leak counts
    await expect(page.getByText(/2/).first()).toBeVisible(); // 2 commits
  });
});

// ===========================================================================
// 5. Metrics Page
// ===========================================================================
test.describe('Metrics Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and subtitle', async ({ page }) => {
    await page.goto('/app/metrics');
    await expect(page.getByRole('heading', { name: /metrics/i })).toBeVisible();
    await expect(page.getByText(/golden rules health metrics/i)).toBeVisible();
  });

  test('has days range selector', async ({ page }) => {
    await page.goto('/app/metrics');
    // Days range is a <select> with options like "7 Days", "14 Days", etc.
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
  });

  test('has compare teams toggle', async ({ page }) => {
    await page.goto('/app/metrics');
    await expect(page.getByRole('button', { name: /compare/i })).toBeVisible();
  });

  test('displays metric selection buttons', async ({ page }) => {
    await page.goto('/app/metrics');
    // Metric pills should be visible
    await expect(page.getByText(/cycle time/i).first()).toBeVisible();
    await expect(page.getByText(/pr review/i).first()).toBeVisible();
  });
});

// ===========================================================================
// 6. Teams Page
// ===========================================================================
test.describe('Teams Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and team cards', async ({ page }) => {
    await page.goto('/app/teams');
    await expect(page.locator('h1').filter({ hasText: 'Teams' })).toBeVisible();
    await expect(page.getByText('Manage your engineering teams')).toBeVisible();
    // Team names visible in cards
    await expect(page.locator('.grid >> text=Backend').first()).toBeVisible();
    await expect(page.locator('.grid >> text=Frontend').first()).toBeVisible();
  });

  test('has New Team button', async ({ page }) => {
    await page.goto('/app/teams');
    await expect(page.getByRole('button', { name: /new team/i })).toBeVisible();
  });

  test('team cards show stats', async ({ page }) => {
    await page.goto('/app/teams');
    await expect(page.getByText(/projects/i).first()).toBeVisible();
    await expect(page.getByText(/events/i).first()).toBeVisible();
  });

  test('team cards have edit and delete buttons', async ({ page }) => {
    await page.goto('/app/teams');
    // Each team card should have edit (pencil) and delete (trash) buttons
    const editButtons = page.locator('button').filter({ has: page.locator('svg') });
    expect(await editButtons.count()).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 7. Projects Page
// ===========================================================================
test.describe('Projects Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading and project cards', async ({ page }) => {
    await page.goto('/app/projects');
    await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
    await expect(page.getByText('API Gateway').first()).toBeVisible();
    await expect(page.getByText('Dashboard').first()).toBeVisible();
  });

  test('has New Project button', async ({ page }) => {
    await page.goto('/app/projects');
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible();
  });

  test('project cards show team assignment', async ({ page }) => {
    await page.goto('/app/projects');
    // Team name visible in project card (not in sidebar scope selector option)
    await expect(page.locator('.grid >> text=Backend').first()).toBeVisible();
  });

  test('project cards show connected tools', async ({ page }) => {
    await page.goto('/app/projects');
    await expect(page.getByText('APIGW').first()).toBeVisible();
  });
});

// ===========================================================================
// 8. Project Activity Page
// ===========================================================================
test.describe('Project Activity Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders project name and breadcrumb', async ({ page }) => {
    await page.goto('/app/projects/1');
    await expect(page.getByText('API Gateway').first()).toBeVisible();
    // Breadcrumb back link
    await expect(page.getByText(/projects/i).first()).toBeVisible();
  });

  test('shows connected tools section', async ({ page }) => {
    await page.goto('/app/projects/1');
    await expect(page.getByText(/slack/i).first()).toBeVisible();
    await expect(page.getByText(/jira/i).first()).toBeVisible();
    await expect(page.getByText(/github/i).first()).toBeVisible();
  });

  test('shows activity summary', async ({ page }) => {
    await page.goto('/app/projects/1');
    await expect(page.getByText(/events/i).first()).toBeVisible();
    await expect(page.getByText(/leaks/i).first()).toBeVisible();
  });

  test('has days selector', async ({ page }) => {
    await page.goto('/app/projects/1');
    const selects = page.locator('select');
    expect(await selects.count()).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 9. Settings Page
// ===========================================================================
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => { await mockAllApis(page); });

  test('renders heading', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    await expect(page.getByText(/integration status/i)).toBeVisible();
  });

  test('shows system health section', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByText(/system health/i).first()).toBeVisible();
  });

  test('has refresh button', async ({ page }) => {
    await page.goto('/app/settings');
    const refreshBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await expect(refreshBtn).toBeVisible();
  });

  test('shows integration providers', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByText(/slack/i).first()).toBeVisible();
    await expect(page.getByText(/jira/i).first()).toBeVisible();
    await expect(page.getByText(/github/i).first()).toBeVisible();
  });

  test('shows company information', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByText('Acme Corp').first()).toBeVisible();
  });
});
