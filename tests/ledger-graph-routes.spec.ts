import { test, expect, type Page } from '@playwright/test';

const TEAM_ID = 'team-1';
const TEAM = {
  id: TEAM_ID,
  company_id: 'company-1',
  name: 'Backend',
  slug: 'backend',
  color: '#06b6d4',
  description: 'Backend team',
  lead_user_id: null,
  icon: null,
  project_count: '1',
  event_count_7d: '21',
  active_leak_count: '1',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const LEDGER_TREE = {
  commits: [
    {
      id: 'c1',
      commit_type: 'decision',
      title: 'Reduce checkout retries',
      summary: 'Add bounded retries to checkout polling loop.',
      rationale: null,
      dri: 'alice',
      status: 'approved',
      branch_name: 'main',
      parent_commit_id: null,
      team_id: TEAM_ID,
      project_id: null,
      scope_level: null,
      promoted_from: null,
      evidence_links: [],
      tags: ['reliability'],
      created_by: 'alice',
      approved_by: 'lead',
      created_at: '2026-03-02T10:00:00Z',
      edges: [
        {
          id: 'edge-1',
          edge_type: 'triggered_by',
          target_type: 'leak_instance',
          target_id: 'l1',
          metadata: {},
          target_data: null,
        },
      ],
    },
  ],
  teams: [
    {
      id: TEAM_ID,
      name: 'Backend',
      slug: 'backend',
      color: '#06b6d4',
      icon: null,
    },
  ],
  leaks: [
    {
      id: 'l1',
      rule_key: 'decision_drift',
      title: 'Decision drift in checkout flow',
      severity: 72,
      team_id: TEAM_ID,
      created_at: '2026-03-02T11:00:00Z',
      status: 'detected',
    },
  ],
  entities: [],
  inferred_links: [],
  availableFilters: {
    branches: ['main'],
    jira_keys: [],
    github_prs: [],
    slack_channels: [],
    tags: ['reliability'],
  },
};

type SavedRouteRow = {
  id: string;
  name: string;
  solution_draft: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
};

type DispatchCall = {
  routeId: string;
  provider: 'slack' | 'jira' | 'github';
  target: string;
  actor: string;
};

type MockState = {
  savedRoutes: SavedRouteRow[];
  dispatchCalls: DispatchCall[];
};

async function mockLedgerGraphApis(page: Page): Promise<MockState> {
  const state: MockState = {
    savedRoutes: [],
    dispatchCalls: [],
  };

  await page.route('**/api/teams/health*', (route) =>
    route.fulfill({
      json: {
        teams: [
          {
            id: TEAM_ID,
            name: 'Backend',
            slug: 'backend',
            color: '#06b6d4',
            leakCount: 1,
            activeLeaks: 1,
            eventCount7d: 21,
            metrics: {},
            healthScore: 78,
          },
        ],
        company_health_score: 78,
      },
    }),
  );

  await page.route('**/api/teams*', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { teams: [TEAM] } });
    }
    return route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
  });

  await page.route('**/api/projects**', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { projects: [] } });
    }
    return route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
  });

  await page.route('**/api/ledger/tree*', (route) =>
    route.fulfill({ json: LEDGER_TREE }),
  );

  await page.route('**/api/ledger/routes/*/dispatch', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
    }

    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const routeId = parts[parts.length - 2];
    const body = route.request().postDataJSON() as DispatchCall;

    state.dispatchCalls.push({
      routeId,
      provider: body.provider,
      target: body.target,
      actor: body.actor,
    });

    return route.fulfill({
      json: {
        dispatch: {
          id: `dispatch-${state.dispatchCalls.length}`,
        },
      },
    });
  });

  await page.route('**/api/ledger/routes/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      return route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
    }

    const url = new URL(route.request().url());
    const routeId = url.pathname.split('/').pop() as string;

    state.savedRoutes = state.savedRoutes.filter((savedRoute) => savedRoute.id !== routeId);

    return route.fulfill({ json: { deleted: true, id: routeId } });
  });

  await page.route('**/api/ledger/routes*', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      return route.fulfill({ json: { routes: state.savedRoutes } });
    }

    if (method === 'POST') {
      const payload = route.request().postDataJSON() as {
        name: string;
        solution_draft?: string;
        snapshot: Record<string, unknown>;
      };

      const sourceSnapshot = payload.snapshot as {
        traversal?: Record<string, unknown>;
      };

      const snapshotWithFocus = {
        ...payload.snapshot,
        traversal: {
          ...(sourceSnapshot.traversal || {}),
          lockedFocusIds: [`team:${TEAM_ID}`],
          lastLockedId: `team:${TEAM_ID}`,
          multiFocusEnabled: false,
          focusDepth: 1,
          navigationLockEnabled: true,
        },
      };

      const created: SavedRouteRow = {
        id: `route-${state.savedRoutes.length + 1}`,
        name: payload.name,
        solution_draft: payload.solution_draft?.trim() || null,
        created_at: new Date().toISOString(),
        snapshot: snapshotWithFocus,
      };

      state.savedRoutes = [created, ...state.savedRoutes];
      return route.fulfill({ status: 201, json: { route: created } });
    }

    return route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
  });

  return state;
}

async function openLedgerGraph(page: Page): Promise<void> {
  await page.goto('/app/ledger');
  await page.getByRole('button', { name: /graph/i }).click();
  await expect(page.locator('svg').first()).toBeVisible();
}

async function lockGraphFocus(page: Page): Promise<void> {
  const teamNode = page.locator('svg g rect[rx="5"]').first();
  await expect(teamNode).toBeVisible();
  await teamNode.click();
  await expect(page.getByRole('button', { name: 'Clear Focus' })).toBeVisible();
}

async function saveRouteFromPrompts(page: Page, routeName: string, solutionDraft: string): Promise<void> {
  const promptValues = [routeName, solutionDraft];
  let promptCount = 0;

  const dialogHandler = async (dialog: { accept: (promptText?: string) => Promise<void> }) => {
    const value = promptValues.shift() || '';
    promptCount += 1;
    await dialog.accept(value);
  };

  page.on('dialog', dialogHandler);
  try {
    await page.getByRole('button', { name: 'Save Route' }).click();
    await expect.poll(() => promptCount, { timeout: 5000 }).toBe(2);
  } finally {
    page.off('dialog', dialogHandler);
  }
}

test.describe('Ledger Graph Route Workflows', () => {
  test('save, restore, and delete a route', async ({ page }) => {
    const state = await mockLedgerGraphApis(page);

    await openLedgerGraph(page);

    await saveRouteFromPrompts(page, 'Backend incident route', 'Roll back checkout retry changes');

    await expect(page.getByText('Saved route "Backend incident route"')).toBeVisible();
    await expect.poll(() => state.savedRoutes.length).toBe(1);

    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restored "Backend incident route"')).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Delete Route' }).click();

    await expect(page.getByText('Saved route deleted')).toBeVisible();
    await expect.poll(() => state.savedRoutes.length).toBe(0);
  });

  test('canvas lock blocks accidental clear until disabled', async ({ page }) => {
    await mockLedgerGraphApis(page);

    await openLedgerGraph(page);
    await lockGraphFocus(page);

    const canvas = page.locator('svg').first();
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error('Graph canvas bounding box not available');
    }

    const emptyCanvasPoint = {
      x: box.width - 14,
      y: box.height - 14,
    };

    await canvas.click({ position: emptyCanvasPoint });
    await expect(page.getByRole('button', { name: 'Clear Focus' })).toBeVisible();

    await page.getByRole('button', { name: 'Canvas Lock: On' }).click();
    await expect(page.getByRole('button', { name: 'Canvas Lock: Off' })).toBeVisible();
  });

  test('autosave snapshot is restored after reload', async ({ page }) => {
    await mockLedgerGraphApis(page);

    await openLedgerGraph(page);

    await page.waitForTimeout(450);

    const autosaveRaw = await page.evaluate(() =>
      window.localStorage.getItem('flowguard.ledger.graph.autosave.v1'),
    );

    expect(autosaveRaw).toBeTruthy();
    const autosaveSnapshot = JSON.parse(autosaveRaw as string) as { version: number; datasetSignature: string };
    expect(autosaveSnapshot.version).toBe(1);
    expect(autosaveSnapshot.datasetSignature).toBeTruthy();

    await page.reload();
    await page.getByRole('button', { name: /graph/i }).click();
    await expect(page.getByText('Restored previous traversal')).toBeVisible();
  });

  test('dispatches saved route review packet', async ({ page }) => {
    const state = await mockLedgerGraphApis(page);

    await openLedgerGraph(page);
    await saveRouteFromPrompts(page, 'Dispatch candidate', 'Notify release channel');

    await page.getByPlaceholder('#channel or C12345678').fill('#release-triage');
    await page.getByRole('button', { name: 'Send Review' }).click();

    await expect(page.getByText('Review packet sent to slack')).toBeVisible();
    await expect.poll(() => state.dispatchCalls.length).toBe(1);

    const dispatchCall = state.dispatchCalls[0];
    expect(dispatchCall.provider).toBe('slack');
    expect(dispatchCall.target).toBe('#release-triage');
    expect(dispatchCall.routeId).toBe('route-1');
  });

  test('filter mode keeps non-matching nodes hoverable but not clickable', async ({ page }) => {
    await mockLedgerGraphApis(page);

    await openLedgerGraph(page);
    await page.locator('main select').first().selectOption('action');

    await expect(page.getByText(/Filter mode:/i)).toBeVisible();

    const commitNode = page.locator('svg g circle').first();
    await expect(commitNode).toBeVisible();

    await commitNode.hover();
    await expect(page.getByText('Commit Detail')).toBeVisible();

    await commitNode.click();
    await expect(page.getByRole('button', { name: 'Clear Focus' })).toHaveCount(0);
  });

  test('clicking graph nodes does not reset page scroll', async ({ page }) => {
    await mockLedgerGraphApis(page);

    await openLedgerGraph(page);

    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);

    const teamNode = page.locator('svg g rect[rx="5"]').first();
    await teamNode.click();

    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});
