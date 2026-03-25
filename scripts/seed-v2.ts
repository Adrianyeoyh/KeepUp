/**
 * Seed v2 data: teams and projects for the existing Acme Corp company.
 * Run: npx tsx scripts/seed-v2.ts
 */
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://flowguard:flowguard@localhost:5432/flowguard',
});

interface SeedEventRow {
  id: string;
  source: string;
  entity_id: string;
}

interface SeedCommitRow {
  id: string;
  leak_instance_id: string | null;
  parent_commit_id: string | null;
  evidence_links: Array<Record<string, unknown>> | null;
  created_at: string;
}

interface SeedActionRow {
  id: string;
  leak_instance_id: string | null;
}

function resolveEvidenceEventId(
  evidence: Record<string, unknown>,
  eventIdByEntity: Map<string, string>,
): string | null {
  const directEventId = evidence.event_id;
  if (typeof directEventId === 'string' && directEventId.length > 0) {
    return directEventId;
  }

  const provider = evidence.provider;
  const entityId = evidence.entity_id;
  if (typeof provider === 'string' && typeof entityId === 'string') {
    return eventIdByEntity.get(`${provider}:${entityId}`) || null;
  }

  return null;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function seedV2() {
  const client = await pool.connect();

  try {
    // Get company ID
    const companyResult = await client.query('SELECT id FROM companies ORDER BY created_at ASC LIMIT 1');
    const companyId = companyResult.rows[0]?.id;
    if (!companyId) {
      throw new Error('No company found. Run npm run seed:dev first.');
    }
    console.log(`Company: ${companyId}`);

    await client.query('BEGIN');

    // Clean existing v2 data (idempotent re-runs)
    await client.query('DELETE FROM projects WHERE company_id = $1', [companyId]);
    await client.query('DELETE FROM teams WHERE company_id = $1', [companyId]);

    // Create teams
    const teams = [
      { name: 'Platform Squad', slug: 'platform', color: '#3B82F6', description: 'Core infrastructure, APIs, and auth', lead: 'U_ALICE' },
      { name: 'Mobile Team', slug: 'mobile', color: '#10B981', description: 'iOS and Android apps', lead: 'U_BOB' },
      { name: 'Payments Team', slug: 'payments', color: '#F59E0B', description: 'Payment processing and billing', lead: 'U_CAROL' },
    ];

    const teamIds: Record<string, string> = {};
    for (const team of teams) {
      const res = await client.query(
        `INSERT INTO teams (company_id, name, slug, color, description, lead_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [companyId, team.name, team.slug, team.color, team.description, team.lead],
      );
      teamIds[team.slug] = res.rows[0].id;
      console.log(`  Team: ${team.name} [${res.rows[0].id}]`);
    }

    // Create projects
    const projects = [
      {
        name: 'Q2 Auth Migration',
        slug: 'q2-auth-migration',
        team: 'platform',
        description: 'Migrate all services from session-based to JWT auth',
        jira_keys: ['AUTH', 'PLAT', 'PROJ'],
        github_repos: ['acme/main-app', 'acme/api', 'acme/auth-service'],
        slack_channels: ['C_AUTH_MIGRATION', 'C_ENG_PLATFORM', 'C_GENERAL'],
        target_date: '2026-03-31',
      },
      {
        name: 'Mobile App v3',
        slug: 'mobile-v3',
        team: 'mobile',
        description: 'Major mobile app redesign with new navigation',
        jira_keys: ['MOB'],
        github_repos: ['acme/mobile-ios', 'acme/mobile-android'],
        slack_channels: ['C_MOBILE'],
        target_date: '2026-04-15',
      },
      {
        name: 'Payment Gateway Upgrade',
        slug: 'payment-gateway',
        team: 'payments',
        description: 'Upgrade Stripe integration to v2024 API with multi-currency support',
        jira_keys: ['PAY'],
        github_repos: ['acme/payments'],
        slack_channels: ['C_PAYMENTS', 'C_BILLING'],
        target_date: '2026-03-20',
      },
      {
        name: 'Observability Stack',
        slug: 'observability',
        team: 'platform',
        description: 'Deploy OpenTelemetry, Grafana dashboards, and alerting',
        jira_keys: ['OBS', 'PLAT'],
        github_repos: ['acme/infra', 'acme/api'],
        slack_channels: ['C_INFRA'],
        target_date: '2026-04-30',
      },
    ];

    const projectIds: Record<string, string> = {};
    for (const project of projects) {
      const res = await client.query(
        `INSERT INTO projects (company_id, team_id, name, slug, description,
          jira_project_keys, github_repos, slack_channel_ids, target_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          companyId,
          teamIds[project.team],
          project.name,
          project.slug,
          project.description,
          project.jira_keys,
          project.github_repos,
          project.slack_channels,
          project.target_date,
        ],
      );
      projectIds[project.slug] = res.rows[0].id;
      console.log(`  Project: ${project.name} -> ${project.team} [${res.rows[0].id}]`);
    }

    // Seed cross-platform user identity mappings when the Phase 4 table exists.
    let identityMappingsSeeded = 0;
    const identityTableCheck = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.user_identity_map') IS NOT NULL AS exists`,
    );

    if (identityTableCheck.rows[0]?.exists) {
      const identityMappings = [
        {
          teamSlug: 'platform',
          slackUserId: 'U_ALICE',
          githubUsername: 'alice-platform',
          jiraAccountId: 'jira-alice',
          displayName: 'Alice Platform',
        },
        {
          teamSlug: 'platform',
          slackUserId: 'U_SARAH',
          githubUsername: 'sarah-platform',
          jiraAccountId: 'jira-sarah',
          displayName: 'Sarah Platform',
        },
        {
          teamSlug: 'mobile',
          slackUserId: 'U_BOB',
          githubUsername: 'bob-mobile',
          jiraAccountId: 'jira-bob',
          displayName: 'Bob Mobile',
        },
        {
          teamSlug: 'mobile',
          slackUserId: 'U_JAMES',
          githubUsername: 'james-mobile',
          jiraAccountId: 'jira-james',
          displayName: 'James Mobile',
        },
        {
          teamSlug: 'payments',
          slackUserId: 'U_CAROL',
          githubUsername: 'carol-payments',
          jiraAccountId: 'jira-carol',
          displayName: 'Carol Payments',
        },
        {
          teamSlug: 'payments',
          slackUserId: 'U_DAN',
          githubUsername: 'dan-payments',
          jiraAccountId: 'jira-dan',
          displayName: 'Dan Payments',
        },
      ];

      for (const mapping of identityMappings) {
        const teamId = teamIds[mapping.teamSlug];
        if (!teamId) continue;

        await client.query(
          `INSERT INTO user_identity_map (
            team_id,
            slack_user_id,
            github_username,
            jira_account_id,
            display_name
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            teamId,
            mapping.slackUserId,
            mapping.githubUsername,
            mapping.jiraAccountId,
            mapping.displayName,
          ],
        );
        identityMappingsSeeded += 1;
      }

      console.log(`  Identity mappings: ${identityMappingsSeeded}`);
    }

    // Backfill: normalize all existing scope links first, then re-apply deterministic mapping.
    const platformTeamId = teamIds['platform'];
    const mobileTeamId = teamIds['mobile'];
    const paymentsTeamId = teamIds['payments'];

    const authProjectId = projectIds['q2-auth-migration'];
    const mobileProjectId = projectIds['mobile-v3'];
    const paymentsProjectId = projectIds['payment-gateway'];
    const observabilityProjectId = projectIds['observability'];

    await client.query(
      `UPDATE events SET team_id = NULL, project_id = NULL WHERE company_id = $1`,
      [companyId],
    );

    // Source-based mapping gives predictable multi-team topology in seeded demos.
    await client.query(
      `UPDATE events
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND source = 'github'`,
      [platformTeamId, authProjectId, companyId],
    );
    await client.query(
      `UPDATE events
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND source = 'jira'`,
      [mobileTeamId, mobileProjectId, companyId],
    );
    await client.query(
      `UPDATE events
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND source = 'slack'`,
      [paymentsTeamId, paymentsProjectId, companyId],
    );

    await client.query(
      `UPDATE leak_instances SET team_id = NULL, project_id = NULL WHERE company_id = $1`,
      [companyId],
    );

    await client.query(
      `UPDATE leak_instances
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND leak_type = 'pr_review_bottleneck'`,
      [platformTeamId, authProjectId, companyId],
    );
    await client.query(
      `UPDATE leak_instances
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND leak_type IN ('reopen_bounce_spike', 'cycle_time_drift')`,
      [mobileTeamId, mobileProjectId, companyId],
    );
    await client.query(
      `UPDATE leak_instances
       SET team_id = $1, project_id = $2
       WHERE company_id = $3 AND leak_type IN ('decision_drift', 'unlogged_action_items')`,
      [paymentsTeamId, paymentsProjectId, companyId],
    );

    await client.query(
      `UPDATE proposed_actions pa
       SET team_id = li.team_id
       FROM leak_instances li
       WHERE pa.company_id = $1
         AND li.company_id = $1
         AND pa.leak_instance_id = li.id`,
      [companyId],
    );

    await client.query(
      `UPDATE ledger_commits
       SET team_id = NULL, project_id = NULL, scope_level = COALESCE(scope_level, 'team')
       WHERE company_id = $1`,
      [companyId],
    );

    const scopedLeaksResult = await client.query<{
      id: string;
      team_id: string | null;
      project_id: string | null;
    }>(
      `SELECT id::text AS id, team_id::text, project_id::text
       FROM leak_instances
       WHERE company_id = $1`,
      [companyId],
    );

    const leakScopeById = new Map(
      scopedLeaksResult.rows.map((row) => [
        row.id,
        {
          team_id: row.team_id,
          project_id: row.project_id,
        },
      ]),
    );

    const scopedEventsResult = await client.query<{
      source: string;
      entity_id: string;
      team_id: string | null;
      project_id: string | null;
    }>(
      `SELECT source, entity_id, team_id::text, project_id::text
       FROM events
       WHERE company_id = $1
       ORDER BY timestamp DESC`,
      [companyId],
    );

    const eventScopeByEntity = new Map<string, { team_id: string | null; project_id: string | null }>();
    for (const row of scopedEventsResult.rows) {
      const key = `${row.source}:${row.entity_id}`;
      if (!eventScopeByEntity.has(key)) {
        eventScopeByEntity.set(key, {
          team_id: row.team_id,
          project_id: row.project_id,
        });
      }
    }

    const commitsForScopingResult = await client.query<SeedCommitRow>(
      `SELECT id::text AS id, leak_instance_id::text, parent_commit_id::text, evidence_links, created_at
       FROM ledger_commits
       WHERE company_id = $1
       ORDER BY created_at ASC`,
      [companyId],
    );

    const fallbackTeamIds = [platformTeamId, mobileTeamId, paymentsTeamId];
    const fallbackProjectIds = [authProjectId, mobileProjectId, paymentsProjectId, observabilityProjectId];

    let scopedCommitCount = 0;
    let orgScopedCount = 0;

    for (const commit of commitsForScopingResult.rows) {
      const hash = stableHash(commit.id);

      let teamId: string | null = null;
      let projectId: string | null = null;
      let scopeLevel: 'org' | 'team' | 'project' = 'team';

      if (commit.leak_instance_id) {
        const leakScope = leakScopeById.get(commit.leak_instance_id);
        if (leakScope?.team_id) {
          teamId = leakScope.team_id;
          projectId = leakScope.project_id;
        }
      }

      if (!teamId) {
        const evidenceLinks = Array.isArray(commit.evidence_links) ? commit.evidence_links : [];
        for (const evidence of evidenceLinks) {
          if (!evidence || typeof evidence !== 'object') continue;
          const provider = evidence.provider;
          const entityId = evidence.entity_id;
          if (typeof provider !== 'string' || typeof entityId !== 'string') continue;

          const eventScope = eventScopeByEntity.get(`${provider}:${entityId}`);
          if (!eventScope?.team_id) continue;

          teamId = eventScope.team_id;
          projectId = eventScope.project_id;
          break;
        }
      }

      if (!teamId && hash % 11 === 0) {
        scopeLevel = 'org';
      } else {
        teamId = teamId || fallbackTeamIds[hash % fallbackTeamIds.length];
        projectId = projectId || fallbackProjectIds[hash % fallbackProjectIds.length];
        scopeLevel = hash % 4 === 0 ? 'project' : 'team';
      }

      await client.query(
        `UPDATE ledger_commits
         SET team_id = $1,
             project_id = $2,
             scope_level = $3
         WHERE id = $4`,
        [
          scopeLevel === 'org' ? null : teamId,
          scopeLevel === 'org' ? null : projectId,
          scopeLevel,
          commit.id,
        ],
      );

      scopedCommitCount += 1;
      if (scopeLevel === 'org') orgScopedCount += 1;
    }

    console.log(`  Commit scope backfill: ${scopedCommitCount} commits (${orgScopedCount} org-level)`);

    // Rebuild edges from current commit context so graph/tree view remains connected.
    await client.query(`DELETE FROM ledger_edges WHERE company_id = $1`, [companyId]);

    const eventsResult = await client.query<SeedEventRow>(
      `SELECT id::text AS id, source, entity_id
       FROM events
       WHERE company_id = $1
       ORDER BY timestamp DESC`,
      [companyId],
    );

    const eventIdSet = new Set(eventsResult.rows.map((row) => row.id));
    const eventIdByEntity = new Map<string, string>();
    for (const row of eventsResult.rows) {
      const key = `${row.source}:${row.entity_id}`;
      if (!eventIdByEntity.has(key)) {
        eventIdByEntity.set(key, row.id);
      }
    }

    const leaksResult = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM leak_instances WHERE company_id = $1`,
      [companyId],
    );
    const leakIdSet = new Set(leaksResult.rows.map((row) => row.id));

    const commitsResult = await client.query<SeedCommitRow>(
      `SELECT id::text AS id, leak_instance_id::text, parent_commit_id::text, evidence_links, created_at
       FROM ledger_commits
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [companyId],
    );
    const commitIdSet = new Set(commitsResult.rows.map((row) => row.id));

    const edgeRows: Array<{
      commit_id: string;
      target_type: string;
      target_id: string;
      edge_type: string;
      metadata: Record<string, unknown>;
    }> = [];
    const edgeDedup = new Set<string>();

    const pushEdge = (
      commitId: string,
      targetType: string,
      targetId: string,
      edgeType: string,
      metadata: Record<string, unknown> = {},
    ) => {
      const key = `${commitId}|${targetType}|${targetId}|${edgeType}`;
      if (edgeDedup.has(key)) return;
      edgeDedup.add(key);
      edgeRows.push({
        commit_id: commitId,
        target_type: targetType,
        target_id: targetId,
        edge_type: edgeType,
        metadata,
      });
    };

    for (const commit of commitsResult.rows) {
      if (commit.leak_instance_id && leakIdSet.has(commit.leak_instance_id)) {
        pushEdge(commit.id, 'leak_instance', commit.leak_instance_id, 'triggered_by');
      }

      if (commit.parent_commit_id && commitIdSet.has(commit.parent_commit_id)) {
        pushEdge(commit.id, 'ledger_commit', commit.parent_commit_id, 'depends_on');
      }

      const evidenceLinks = Array.isArray(commit.evidence_links) ? commit.evidence_links : [];
      for (const evidence of evidenceLinks) {
        if (!evidence || typeof evidence !== 'object') continue;
        const eventId = resolveEvidenceEventId(evidence, eventIdByEntity);
        if (!eventId || !eventIdSet.has(eventId)) continue;
        pushEdge(commit.id, 'event', eventId, 'references', {
          provider: typeof evidence.provider === 'string' ? evidence.provider : null,
          entity_id: typeof evidence.entity_id === 'string' ? evidence.entity_id : null,
        });
      }
    }

    const actionsResult = await client.query<SeedActionRow>(
      `SELECT id::text AS id, leak_instance_id::text
       FROM proposed_actions
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [companyId],
    );

    for (const action of actionsResult.rows) {
      if (!action.leak_instance_id) continue;
      const sourceCommit = commitsResult.rows.find(
        (commit) => commit.leak_instance_id === action.leak_instance_id,
      );
      if (!sourceCommit) continue;
      pushEdge(sourceCommit.id, 'proposed_action', action.id, 'resulted_in');
    }

    for (const edge of edgeRows) {
      await client.query(
        `INSERT INTO ledger_edges (company_id, commit_id, target_type, target_id, edge_type, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [companyId, edge.commit_id, edge.target_type, edge.target_id, edge.edge_type, JSON.stringify(edge.metadata)],
      );
    }

    await client.query('COMMIT');

    console.log('\nv2 seed complete!');
    console.log('  - 3 teams (Platform, Mobile, Payments)');
    console.log('  - 4 projects with Jira/GitHub/Slack mappings');
    if (identityMappingsSeeded > 0) {
      console.log(`  - ${identityMappingsSeeded} user identity mappings seeded`);
    }
    console.log('  - Events, leaks, commits backfilled to team/project scope');
    console.log(`  - Rebuilt ${edgeRows.length} ledger edges`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedV2().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});