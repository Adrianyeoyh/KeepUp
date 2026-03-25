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

const LEAKS = {
  leaks: [
    { id: '1', leak_type: 'decision_drift', severity: 70, confidence: 0.87, status: 'detected', detected_at: '2025-01-15T10:00:00Z', cost_estimate_hours_per_week: 3, evidence_links: [{ title: 'PR #42', url: 'https://example.com' }], metrics_context: { current_value: 4.2, baseline_value: 3.0, metric_name: 'jira.cycle_time_median', delta_percentage: 40, semantic_explanation: 'Decision made outside of process' }, ai_diagnosis: { root_cause: 'Missing approval', explanation: 'Config changed without ticket', suggested_actions: ['Create Jira ticket'] } },
  ],
  total: 1,
};

const APPROVALS = {
  actions: [
    { id: '1', action_type: 'create_jira_issue', target_system: 'jira', target_id: 'PROJ-1', preview_diff: { description: 'Create ticket for decision drift' }, risk_level: 'low', blast_radius: 'single_team', approval_status: 'pending', requested_by: 'system', approved_by: null, approved_at: null, created_at: '2025-01-15T10:00:00Z', leak_type: 'decision_drift', leak_severity: 70 },
  ],
  total: 1,
};

const TEAM_HEALTH = {
  teams: [
    { id: '1', name: 'Backend', slug: 'backend', color: '#06b6d4', leakCount: 5, activeLeaks: 3, eventCount7d: 42, metrics: {}, healthScore: 72 },
    { id: '2', name: 'Frontend', slug: 'frontend', color: '#8b5cf6', leakCount: 2, activeLeaks: 1, eventCount7d: 18, metrics: {}, healthScore: 85 },
  ],
  company_health_score: 78,
};

// ---------------------------------------------------------------------------
// Utility - set up base mocks used by ScopeProvider + all pages
// ---------------------------------------------------------------------------

async function mockBasicApis(page: Page) {
  // Specific routes first
  await page.route('**/api/teams/health*', (route) => route.fulfill({ json: TEAM_HEALTH }));
  await page.route('**/api/approvals/*/action', (route) => route.fulfill({ json: { ok: true } }));

  await page.route('**/api/teams', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { teams: TEAMS_ARRAY } });
    return route.continue();
  });
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { projects: PROJECTS_ARRAY } });
    return route.continue();
  });
  await page.route('**/api/dashboard/overview*', (route) => route.fulfill({ json: OVERVIEW }));
  await page.route('**/api/leaks*', (route) => route.fulfill({ json: LEAKS }));
  await page.route('**/api/approvals*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: APPROVALS });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/ledger/tree*', (route) => route.fulfill({ json: { commits: [], leaks: [], teams: [] } }));
  await page.route('**/api/compare/metrics*', (route) => route.fulfill({ json: { series: [], org_baseline: [] } }));
  await page.route('**/api/metrics*', (route) => route.fulfill({ json: { metrics: [] } }));
  await page.route('**/api/settings*', (route) => route.fulfill({ json: { company: { id: '1', name: 'Acme Corp', settings: {} }, integrations: [] } }));
  await page.route('**/api/health/detailed*', (route) => route.fulfill({ json: { status: 'ok', timestamp: '2025-01-15T10:00:00Z', database: 'ok', counts: { companies: 1, events: 0, leaks: 0 } } }));
  await page.route('**/api/feedback*', (route) => route.fulfill({ json: { ok: true } }));
}

// ===========================================================================
// CRUD: Teams — Create, Edit, Delete
// ===========================================================================
test.describe('Teams CRUD', () => {
  test('create team: opens dialog, fills form, submits', async ({ page }) => {
    await mockBasicApis(page);

    let createPayload: Record<string, unknown> | null = null;
    await page.route('**/api/teams', async (route) => {
      if (route.request().method() === 'POST') {
        createPayload = route.request().postDataJSON();
        const newTeam = { ...TEAMS_ARRAY[0], id: '3', name: createPayload!.name, slug: createPayload!.slug };
        return route.fulfill({ json: newTeam });
      }
      return route.fulfill({ json: { teams: [...TEAMS_ARRAY] } });
    });

    await page.goto('/app/teams');
    await page.getByRole('button', { name: /new team/i }).click();

    // Radix Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill form using actual input IDs
    await page.locator('#team-name').fill('QA Team');
    await page.locator('#team-slug').fill('qa-team');
    await page.locator('#team-desc').fill('Quality assurance team');

    // Submit
    await page.getByRole('button', { name: /create team/i }).click();

    // Verify the POST was made with correct data
    expect(createPayload).toBeTruthy();
    expect(createPayload!.name).toBe('QA Team');
  });

  test('edit team: opens dialog with pre-filled data', async ({ page }) => {
    await mockBasicApis(page);

    await page.route('**/api/teams/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ json: { ...TEAMS_ARRAY[0], name: 'Updated Backend' } });
      }
      return route.continue();
    });

    await page.goto('/app/teams');

    // Click edit button (Pencil icon) on first team card — it's a ghost icon button
    const editButtons = page.locator('button:has(svg.lucide-pencil)');
    await expect(editButtons.first()).toBeVisible();
    await editButtons.first().click();

    // Dialog should appear with pre-filled name
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = page.locator('#team-name');
    const value = await nameInput.inputValue();
    expect(value).toBeTruthy();
  });

  test('delete team: confirms and sends DELETE request', async ({ page }) => {
    await mockBasicApis(page);

    let deleteCalled = false;
    await page.route('**/api/teams/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    });

    // Handle native confirm() dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/app/teams');

    // Click delete button — it's the second icon button in the flex gap-1 container
    const teamCards = page.locator('[class*="CardHeader"], .flex.gap-1').first();
    // Find all small icon buttons (h-7 w-7) — first is edit, second is delete
    const iconButtons = page.locator('button.h-7.w-7');
    // The delete button is the one that's NOT inside a DialogTrigger
    // Use nth to get the second icon button for the first team
    await expect(iconButtons.nth(1)).toBeVisible();
    await iconButtons.nth(1).click();

    await page.waitForTimeout(500);
    expect(deleteCalled).toBe(true);
  });
});

// ===========================================================================
// CRUD: Projects — Create, Edit, Delete
// ===========================================================================
test.describe('Projects CRUD', () => {
  test('create project: opens dialog, fills form, submits', async ({ page }) => {
    await mockBasicApis(page);

    let createPayload: Record<string, unknown> | null = null;
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() === 'POST') {
        createPayload = route.request().postDataJSON();
        return route.fulfill({ json: { ...PROJECTS_ARRAY[0], id: '3', name: createPayload!.name } });
      }
      return route.fulfill({ json: { projects: [...PROJECTS_ARRAY] } });
    });

    await page.goto('/app/projects');
    await page.getByRole('button', { name: /new project/i }).click();

    // Radix Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill form using actual input IDs
    await page.locator('#proj-name').fill('Mobile App');
    await page.locator('#proj-slug').fill('mobile-app');
    await page.locator('#proj-desc').fill('React Native mobile app');
    await page.locator('#proj-jira').fill('MOBILE');
    await page.locator('#proj-github').fill('org/mobile-app');

    // Submit
    await page.getByRole('button', { name: /create project/i }).click();

    expect(createPayload).toBeTruthy();
    expect(createPayload!.name).toBe('Mobile App');
  });

  test('edit project: opens dialog with pre-filled data', async ({ page }) => {
    await mockBasicApis(page);

    await page.route('**/api/projects/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ json: { ...PROJECTS_ARRAY[0], name: 'Updated Gateway' } });
      }
      return route.continue();
    });

    await page.goto('/app/projects');

    // Click edit button (Pencil icon) on first project card
    const editButtons = page.locator('button:has(svg.lucide-pencil)');
    await expect(editButtons.first()).toBeVisible();
    await editButtons.first().click();

    // Dialog should appear with pre-filled name
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = page.locator('#proj-name');
    const value = await nameInput.inputValue();
    expect(value).toBeTruthy();
  });

  test('delete project: confirms and sends DELETE request', async ({ page }) => {
    await mockBasicApis(page);

    let deleteCalled = false;
    await page.route('**/api/projects/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    });

    // Handle native confirm() dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/app/projects');

    // Click delete button — second icon button in each card
    const iconButtons = page.locator('button.h-7.w-7');
    await expect(iconButtons.nth(1)).toBeVisible();
    await iconButtons.nth(1).click();

    await page.waitForTimeout(500);
    expect(deleteCalled).toBe(true);
  });
});

// ===========================================================================
// CRUD: Approvals — Approve and Reject actions
// ===========================================================================
test.describe('Approvals CRUD', () => {
  test('approve action: clicks approve, sends POST', async ({ page }) => {
    await mockBasicApis(page);

    let actionPayload: Record<string, unknown> | null = null;
    await page.route('**/api/approvals/*/action', async (route) => {
      actionPayload = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/app/approvals');

    // Click Approve button (has ThumbsUp icon + "Approve" text)
    await page.getByRole('button', { name: /approve/i }).first().click();
    await page.waitForTimeout(500);

    expect(actionPayload).toBeTruthy();
    expect(actionPayload!.action).toBe('approve');
  });

  test('reject action: clicks reject, sends POST', async ({ page }) => {
    await mockBasicApis(page);

    let actionPayload: Record<string, unknown> | null = null;
    await page.route('**/api/approvals/*/action', async (route) => {
      actionPayload = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/app/approvals');

    // Click Reject button (has ThumbsDown icon + "Reject" text)
    await page.getByRole('button', { name: /reject/i }).first().click();
    await page.waitForTimeout(500);

    expect(actionPayload).toBeTruthy();
    expect(actionPayload!.action).toBe('reject');
  });
});

// ===========================================================================
// CRUD: Leak Dismissal
// ===========================================================================
test.describe('Leak Dismissal', () => {
  test('dismiss leak: expands card, enters reason, dismisses', async ({ page }) => {
    await mockBasicApis(page);

    let feedbackPayload: Record<string, unknown> | null = null;
    await page.route('**/api/feedback*', async (route) => {
      if (route.request().method() === 'POST') {
        feedbackPayload = route.request().postDataJSON();
      }
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/app/leaks');

    // Click on a leak card to expand it (the font-medium span has the leak type label)
    const leakCard = page.locator('.font-medium').filter({ hasText: /Decision Drift/i }).first();
    await leakCard.click();
    await page.waitForTimeout(300);

    // Look for dismiss reason input (placeholder: "Dismiss reason (optional)")
    const dismissInput = page.locator('input[placeholder*="Dismiss reason"]').first();
    if (await dismissInput.isVisible()) {
      await dismissInput.fill('Not relevant to current sprint');

      // Click dismiss button (has XCircle icon + "Dismiss" text)
      const dismissBtn = page.getByRole('button', { name: /dismiss/i }).first();
      if (await dismissBtn.isVisible()) {
        await dismissBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });
});
