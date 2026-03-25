#!/usr/bin/env tsx
// ============================================
// FlowGuard - Dev Seed Script (stress-ready)
// ============================================
// Creates deterministic sample data for local development and stress testing.
// Run: npx tsx scripts/seed-dev.ts
// Optional env controls:
//   SEED_DAYS=180
//   SEED_EVENTS=2200
//   SEED_LEAKS=140
//   SEED_COMMITS=300
//   SEED_ACTIONS=180
//   SEED_VOLUME_MULTIPLIER=1.0
//   SEED_RANDOM_SEED=flowguard-v2

import pg from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://flowguard:flowguard@localhost:5432/flowguard';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

type EventSource = 'slack' | 'jira' | 'github';
type LeakType =
  | 'decision_drift'
  | 'unlogged_action_items'
  | 'reopen_bounce_spike'
  | 'cycle_time_drift'
  | 'pr_review_bottleneck'
  | 'custom_jql';
type LeakStatus = 'detected' | 'delivered' | 'actioned' | 'snoozed' | 'suppressed' | 'resolved';
type CommitType = 'decision' | 'action' | 'policy' | 'template_change';
type CommitStatus = 'draft' | 'proposed' | 'approved' | 'merged' | 'rejected';
type ActionType =
  | 'slack_reminder'
  | 'slack_summary'
  | 'slack_thread_reply'
  | 'jira_comment'
  | 'jira_create_task'
  | 'jira_template_suggest'
  | 'github_comment'
  | 'github_request_review'
  | 'github_reassign';
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'rolled_back';

interface WeightedValue<T> {
  value: T;
  weight: number;
}

interface EvidenceLink {
  provider: EventSource;
  entity_type: string;
  entity_id: string;
  event_id?: string;
  url: string;
  title: string;
}

interface SeedEvent {
  id: string;
  source: EventSource;
  entity_id: string;
  event_type: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  provider_event_id: string;
}

interface SeedLeak {
  id: string;
  leak_type: LeakType;
  severity: number;
  confidence: number;
  status: LeakStatus;
  detected_at: Date;
  evidence_links: EvidenceLink[];
  metrics_context: Record<string, unknown>;
  recommended_fix: Record<string, unknown>;
  cost_estimate_hours_per_week: number;
  ai_diagnosis: Record<string, unknown> | null;
}

interface SeedCommit {
  id: string;
  commit_type: CommitType;
  title: string;
  summary: string;
  rationale: string;
  dri: string;
  status: CommitStatus;
  branch_name: string;
  parent_commit_id: string | null;
  leak_instance_id: string | null;
  evidence_links: EvidenceLink[];
  tags: string[];
  created_at: Date;
}

interface SeedAction {
  id: string;
  leak_instance_id: string;
  action_type: ActionType;
  target_system: 'slack' | 'jira' | 'github';
  target_id: string;
  preview_diff: Record<string, unknown>;
  risk_level: 'low' | 'medium' | 'high';
  blast_radius: string;
  approval_status: ApprovalStatus;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

interface SeedPools {
  slackThreads: string[];
  jiraIssues: string[];
  githubPrs: string[];
  threadChannelById: Map<string, string>;
}

const DEFAULT_SEED_DAYS = 180;
const DEFAULT_VOLUME_MULTIPLIER = 1.0;
const DEFAULT_SEED = 'flowguard-v2-stress';

const SLACK_CHANNELS = [
  'C_GENERAL',
  'C_PLATFORM',
  'C_MOBILE',
  'C_PAYMENTS',
  'C_INFRA',
  'C_INCIDENTS',
  'C_RELEASES',
  'C_LEADERSHIP',
];

const JIRA_PROJECT_KEYS = ['PROJ', 'AUTH', 'MOB', 'PAY', 'OBS', 'PLAT'];

const GITHUB_REPOS = [
  'acme/main-app',
  'acme/api',
  'acme/auth-service',
  'acme/mobile-ios',
  'acme/mobile-android',
  'acme/payments',
  'acme/infra',
  'acme/design-system',
];

const DRI_POOL = ['Adrian', 'Sarah', 'Miguel', 'Priya', 'Lina', 'Andre', 'Casey', 'Jordan'];

const SOURCE_WEIGHTS: WeightedValue<EventSource>[] = [
  { value: 'slack', weight: 0.42 },
  { value: 'jira', weight: 0.33 },
  { value: 'github', weight: 0.25 },
];

const LEAK_TYPE_WEIGHTS: WeightedValue<LeakType>[] = [
  { value: 'decision_drift', weight: 0.21 },
  { value: 'unlogged_action_items', weight: 0.17 },
  { value: 'reopen_bounce_spike', weight: 0.19 },
  { value: 'cycle_time_drift', weight: 0.18 },
  { value: 'pr_review_bottleneck', weight: 0.19 },
  { value: 'custom_jql', weight: 0.06 },
];

const COMMIT_TYPE_WEIGHTS: WeightedValue<CommitType>[] = [
  { value: 'decision', weight: 0.34 },
  { value: 'action', weight: 0.36 },
  { value: 'policy', weight: 0.18 },
  { value: 'template_change', weight: 0.12 },
];

const LEAK_STATUS_DEFAULT_WEIGHTS: WeightedValue<LeakStatus>[] = [
  { value: 'detected', weight: 0.28 },
  { value: 'delivered', weight: 0.22 },
  { value: 'actioned', weight: 0.16 },
  { value: 'snoozed', weight: 0.12 },
  { value: 'suppressed', weight: 0.11 },
  { value: 'resolved', weight: 0.11 },
];

const APPROVAL_STATUS_WEIGHTS: WeightedValue<ApprovalStatus>[] = [
  { value: 'pending', weight: 0.26 },
  { value: 'approved', weight: 0.18 },
  { value: 'rejected', weight: 0.11 },
  { value: 'executed', weight: 0.30 },
  { value: 'failed', weight: 0.08 },
  { value: 'rolled_back', weight: 0.07 },
];

const COMMIT_TOPICS: Record<CommitType, string[]> = {
  decision: [
    'auth token rotation strategy',
    'incident escalation threshold',
    'cross-team release ownership model',
    'integration retry budget policy',
    'weekly quality gate criteria',
    'alert fatigue reduction plan',
    'service dependency ownership boundaries',
    'platform migration sequencing',
  ],
  action: [
    'backfill stale Jira acceptance criteria',
    'publish release readiness checklist',
    'enable review rotation reminder bot',
    'ship API contract validation hooks',
    'automate onboarding handoff summary',
    'close unresolved slack thread actions',
    'triage cycle-time outliers',
    'sync incident postmortem templates',
  ],
  policy: [
    'metadata retention limits',
    'approval escalation matrix',
    'branch protection baseline',
    'cross-repo changelog discipline',
    'production rollback guardrails',
    'scope ownership declaration rules',
  ],
  template_change: [
    'jira issue template requirements',
    'pull request checklist defaults',
    'incident review form updates',
    'retro action logging standards',
    'decision record format update',
  ],
};

const METRIC_PROFILES = [
  { name: 'slack.unresolved_threads', base: 14, variance: 8, trend: 0.12 },
  { name: 'slack.thread_length_median', base: 18, variance: 10, trend: 0.06 },
  { name: 'slack.decision_keyword_threads', base: 6, variance: 4, trend: 0.08 },
  { name: 'jira.reopen_rate', base: 0.11, variance: 0.09, trend: 0.03 },
  { name: 'jira.cycle_time_median', base: 84, variance: 28, trend: 0.05 },
  { name: 'jira.blocked_issue_ratio', base: 0.17, variance: 0.08, trend: 0.04 },
  { name: 'github.pr_review_latency_median', base: 26, variance: 14, trend: 0.07 },
  { name: 'github.stalled_prs', base: 5, variance: 4, trend: 0.09 },
];

const LEAK_METRIC_BY_TYPE: Record<LeakType, string> = {
  decision_drift: 'slack.thread_length_median',
  unlogged_action_items: 'slack.decision_keyword_threads',
  reopen_bounce_spike: 'jira.reopen_rate',
  cycle_time_drift: 'jira.cycle_time_median',
  pr_review_bottleneck: 'github.pr_review_latency_median',
  custom_jql: 'jira.blocked_issue_ratio',
};

const ACTIONS_BY_LEAK: Record<LeakType, ActionType[]> = {
  decision_drift: ['slack_summary', 'slack_thread_reply'],
  unlogged_action_items: ['jira_create_task', 'slack_reminder'],
  reopen_bounce_spike: ['jira_template_suggest', 'jira_comment'],
  cycle_time_drift: ['slack_summary', 'jira_comment'],
  pr_review_bottleneck: ['github_request_review', 'github_comment', 'github_reassign'],
  custom_jql: ['jira_comment', 'slack_summary'],
};

function uuid(): string {
  return crypto.randomUUID();
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveNumber(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(min: number, max: number, rand: () => number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weightedPick<T>(values: WeightedValue<T>[], rand: () => number): T {
  const totalWeight = values.reduce((acc, item) => acc + item.weight, 0);
  let cursor = rand() * totalWeight;
  for (const item of values) {
    cursor -= item.weight;
    if (cursor <= 0) return item.value;
  }
  return values[values.length - 1].value;
}

function pickOne<T>(items: T[], rand: () => number): T {
  return items[randomInt(0, items.length - 1, rand)];
}

function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function makeTimestamp(daysAgo: number, rand: () => number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(randomInt(0, 23, rand), randomInt(0, 59, rand), randomInt(0, 59, rand), 0);
  return d;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44);
}

function parseGithubEntity(entityId: string): { repo: string; prNumber: string } {
  const [repo, prNumber] = entityId.split('#');
  return { repo, prNumber };
}

function buildSeedPools(seedDays: number): SeedPools {
  const threadCount = Math.max(180, Math.floor(seedDays * 1.7));
  const issuesPerProject = Math.max(90, Math.floor(seedDays * 1.1));
  const prsPerRepo = Math.max(65, Math.floor(seedDays * 0.95));

  const threadChannelById = new Map<string, string>();
  const slackThreads = Array.from({ length: threadCount }, (_, idx) => {
    const id = `thread_${1200 + idx}`;
    const channel = SLACK_CHANNELS[idx % SLACK_CHANNELS.length];
    threadChannelById.set(id, channel);
    return id;
  });

  const jiraIssues: string[] = [];
  for (const key of JIRA_PROJECT_KEYS) {
    for (let n = 1; n <= issuesPerProject; n++) {
      jiraIssues.push(`${key}-${100 + n}`);
    }
  }

  const githubPrs: string[] = [];
  for (const repo of GITHUB_REPOS) {
    for (let n = 1; n <= prsPerRepo; n++) {
      githubPrs.push(`${repo}#${300 + n}`);
    }
  }

  return {
    slackThreads,
    jiraIssues,
    githubPrs,
    threadChannelById,
  };
}

function commitStatusForAge(ageDays: number, seedDays: number, rand: () => number): CommitStatus {
  const olderThreshold = Math.floor(seedDays * 0.62);
  const recentThreshold = Math.floor(seedDays * 0.2);

  if (ageDays >= olderThreshold) {
    return weightedPick<CommitStatus>([
      { value: 'merged', weight: 0.62 },
      { value: 'approved', weight: 0.2 },
      { value: 'rejected', weight: 0.08 },
      { value: 'proposed', weight: 0.07 },
      { value: 'draft', weight: 0.03 },
    ], rand);
  }

  if (ageDays <= recentThreshold) {
    return weightedPick<CommitStatus>([
      { value: 'proposed', weight: 0.31 },
      { value: 'draft', weight: 0.23 },
      { value: 'approved', weight: 0.19 },
      { value: 'merged', weight: 0.19 },
      { value: 'rejected', weight: 0.08 },
    ], rand);
  }

  return weightedPick<CommitStatus>([
    { value: 'merged', weight: 0.43 },
    { value: 'approved', weight: 0.24 },
    { value: 'proposed', weight: 0.17 },
    { value: 'draft', weight: 0.1 },
    { value: 'rejected', weight: 0.06 },
  ], rand);
}

function leakStatusForAge(ageDays: number, seedDays: number, rand: () => number): LeakStatus {
  const oldLeakThreshold = Math.floor(seedDays * 0.7);
  if (ageDays >= oldLeakThreshold) {
    return weightedPick<LeakStatus>([
      { value: 'resolved', weight: 0.29 },
      { value: 'suppressed', weight: 0.2 },
      { value: 'actioned', weight: 0.18 },
      { value: 'delivered', weight: 0.16 },
      { value: 'snoozed', weight: 0.09 },
      { value: 'detected', weight: 0.08 },
    ], rand);
  }
  return weightedPick(LEAK_STATUS_DEFAULT_WEIGHTS, rand);
}

function actionSystem(actionType: ActionType): 'slack' | 'jira' | 'github' {
  if (actionType.startsWith('slack_')) return 'slack';
  if (actionType.startsWith('jira_')) return 'jira';
  return 'github';
}

function buildEvidence(
  source: EventSource,
  pools: SeedPools,
  eventIdByEntity: Map<string, string>,
  rand: () => number,
): EvidenceLink {
  if (source === 'slack') {
    const threadId = pickOne(pools.slackThreads, rand);
    const channel = pools.threadChannelById.get(threadId) || 'C_GENERAL';
    return {
      provider: 'slack',
      entity_type: 'thread',
      entity_id: threadId,
      event_id: eventIdByEntity.get(`slack:${threadId}`),
      url: `https://acme.slack.com/archives/${channel}`,
      title: `${channel} thread ${threadId}`,
    };
  }

  if (source === 'jira') {
    const issueKey = pickOne(pools.jiraIssues, rand);
    return {
      provider: 'jira',
      entity_type: 'issue',
      entity_id: issueKey,
      event_id: eventIdByEntity.get(`jira:${issueKey}`),
      url: `https://acme.atlassian.net/browse/${issueKey}`,
      title: `Issue ${issueKey}`,
    };
  }

  const prEntity = pickOne(pools.githubPrs, rand);
  const { repo, prNumber } = parseGithubEntity(prEntity);
  return {
    provider: 'github',
    entity_type: 'pr',
    entity_id: prEntity,
    event_id: eventIdByEntity.get(`github:${prEntity}`),
    url: `https://github.com/${repo}/pull/${prNumber}`,
    title: `${repo} PR #${prNumber}`,
  };
}

function buildLeakEvidence(
  leakType: LeakType,
  pools: SeedPools,
  eventIdByEntity: Map<string, string>,
  rand: () => number,
): EvidenceLink[] {
  const primarySource: EventSource =
    leakType === 'pr_review_bottleneck'
      ? 'github'
      : leakType === 'reopen_bounce_spike' || leakType === 'cycle_time_drift' || leakType === 'custom_jql'
        ? 'jira'
        : 'slack';

  const evidenceCount = leakType === 'custom_jql' ? 2 : randomInt(1, 2, rand);
  const entries: EvidenceLink[] = [];

  for (let i = 0; i < evidenceCount; i++) {
    const source = i === 0 ? primarySource : weightedPick(SOURCE_WEIGHTS, rand);
    entries.push(buildEvidence(source, pools, eventIdByEntity, rand));
  }

  return entries;
}

function commitTitle(type: CommitType, topic: string, index: number): string {
  if (type === 'decision') return `Decide ${topic} (${index + 1})`;
  if (type === 'action') return `Execute ${topic} (${index + 1})`;
  if (type === 'policy') return `Policy update: ${topic} (${index + 1})`;
  return `Template change: ${topic} (${index + 1})`;
}

function inferTargetIdForAction(
  actionType: ActionType,
  leak: SeedLeak,
  pools: SeedPools,
  rand: () => number,
): string {
  const targetSystem = actionSystem(actionType);

  const matchingEvidence = leak.evidence_links.find((e) => e.provider === targetSystem);
  if (matchingEvidence) {
    if (targetSystem === 'slack') {
      const channel = pools.threadChannelById.get(matchingEvidence.entity_id);
      return channel || matchingEvidence.entity_id;
    }
    return matchingEvidence.entity_id;
  }

  if (targetSystem === 'slack') return pickOne(SLACK_CHANNELS, rand);
  if (targetSystem === 'jira') return pickOne(pools.jiraIssues, rand);
  return pickOne(pools.githubPrs, rand);
}

async function seed() {
  const client = await pool.connect();

  const volumeMultiplier = parsePositiveNumber(process.env.SEED_VOLUME_MULTIPLIER, DEFAULT_VOLUME_MULTIPLIER);
  const seedDays = parsePositiveInt(process.env.SEED_DAYS, DEFAULT_SEED_DAYS);
  const seedRandom = process.env.SEED_RANDOM_SEED || DEFAULT_SEED;
  const rand = createRng(seedRandom);

  const eventTarget = parsePositiveInt(process.env.SEED_EVENTS, Math.max(600, Math.floor(seedDays * 12 * volumeMultiplier)));
  const leakTarget = parsePositiveInt(process.env.SEED_LEAKS, Math.max(95, Math.floor(seedDays * 0.75 * volumeMultiplier)));
  const commitTarget = parsePositiveInt(process.env.SEED_COMMITS, Math.max(240, Math.floor(seedDays * 1.4 * volumeMultiplier)));
  const actionTarget = parsePositiveInt(process.env.SEED_ACTIONS, Math.max(130, Math.floor(leakTarget * 1.1)));

  const pools = buildSeedPools(seedDays);

  try {
    await client.query('BEGIN');

    console.log('Seeding FlowGuard dev data...');
    console.log(`  horizon_days=${seedDays}`);
    console.log(`  events=${eventTarget}, leaks=${leakTarget}, commits=${commitTarget}, actions=${actionTarget}`);
    console.log(`  random_seed=${seedRandom}`);

    const existingCompany = await client.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug = $1 LIMIT 1`,
      ['acme-dev'],
    );

    const existingCompanyId = existingCompany.rows[0]?.id;
    if (existingCompanyId) {
      console.log('  Clearing existing acme-dev data...');
      await client.query(`DELETE FROM executed_actions WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM ledger_edges WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM proposed_actions WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM ledger_commits WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM leak_instances WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM metric_snapshots WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM entity_links WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM events WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM projects WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM teams WHERE company_id = $1`, [existingCompanyId]);
      await client.query(`DELETE FROM integrations WHERE company_id = $1`, [existingCompanyId]);
      console.log('  Existing company rows removed');
    }

    const newCompanyId = uuid();
    const companyResult = await client.query<{ id: string }>(
      `INSERT INTO companies (id, name, slug, settings)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         settings = EXCLUDED.settings,
         updated_at = NOW()
       RETURNING id`,
      [
        newCompanyId,
        'Acme Corp (Dev)',
        'acme-dev',
        JSON.stringify({
          insight_budget_per_day: 3,
          confidence_threshold: 0.5,
          digest_cron: '0 9 * * 1-5',
          digest_channel_ids: ['C_DEMO_CHANNEL'],
          digest_user_ids: ['U_DEMO_USER'],
          seed_days: seedDays,
          seed_scale: {
            events: eventTarget,
            leaks: leakTarget,
            commits: commitTarget,
            actions: actionTarget,
          },
        }),
      ],
    );
    const companyId = companyResult.rows[0].id;
    console.log(`  Company ready: ${companyId}`);

    const integrations = [
      {
        id: uuid(),
        provider: 'slack',
        status: 'active',
        installation_data: {
          team_id: 'T_DEMO',
          team_name: 'Acme Workspace',
          channels: SLACK_CHANNELS,
        },
        token_data: { bot_token: 'xoxb-demo-token' },
        scopes: ['channels:read', 'chat:write', 'reactions:read'],
      },
      {
        id: uuid(),
        provider: 'jira',
        status: 'active',
        installation_data: {
          cloud_id: 'demo-cloud',
          base_url: 'https://acme.atlassian.net',
          project_keys: JIRA_PROJECT_KEYS,
        },
        token_data: { access_token: 'demo-jira-token' },
        scopes: ['read:jira-work', 'write:jira-work'],
      },
      {
        id: uuid(),
        provider: 'github',
        status: 'active',
        installation_data: {
          repositories: GITHUB_REPOS,
        },
        token_data: { access_token: 'demo-github-token' },
        scopes: ['repo', 'pull_request'],
      },
    ];

    for (const integration of integrations) {
      await client.query(
        `INSERT INTO integrations (id, company_id, provider, status, installation_data, token_data, scopes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company_id, provider) DO UPDATE SET
           status = EXCLUDED.status,
           installation_data = EXCLUDED.installation_data,
           token_data = EXCLUDED.token_data,
           scopes = EXCLUDED.scopes,
           updated_at = NOW()`,
        [
          integration.id,
          companyId,
          integration.provider,
          integration.status,
          JSON.stringify(integration.installation_data),
          JSON.stringify(integration.token_data),
          integration.scopes,
        ],
      );
    }
    console.log(`  Integrations upserted: ${integrations.length}`);

    const leakConstraintResult = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       WHERE c.conname = 'leak_instances_leak_type_check'
       LIMIT 1`,
    );
    const leakConstraintDefinition = leakConstraintResult.rows[0]?.definition || '';
    const supportsCustomJql = leakConstraintDefinition.includes('custom_jql');
    const leakTypeWeights = supportsCustomJql
      ? LEAK_TYPE_WEIGHTS
      : LEAK_TYPE_WEIGHTS.filter((entry) => entry.value !== 'custom_jql');
    if (!supportsCustomJql) {
      console.log('  Leak constraint does not include custom_jql; seeding only baseline leak types');
    }

    const eventIdByEntity = new Map<string, string>();
    const eventTimestampByEntity = new Map<string, number>();
    const events: SeedEvent[] = [];

    for (let i = 0; i < eventTarget; i++) {
      const source = weightedPick(SOURCE_WEIGHTS, rand);
      const ageDays = randomInt(0, seedDays - 1, rand);
      const timestamp = makeTimestamp(ageDays, rand);

      let entityId = '';
      let eventType = '';
      let metadata: Record<string, unknown> = {};

      if (source === 'slack') {
        const threadId = pickOne(pools.slackThreads, rand);
        const channel = pools.threadChannelById.get(threadId) || 'C_GENERAL';
        entityId = threadId;
        eventType = weightedPick([
          { value: 'slack.message', weight: 0.44 },
          { value: 'slack.thread_reply', weight: 0.31 },
          { value: 'slack.decision_marker', weight: 0.1 },
          { value: 'slack.reminder', weight: 0.08 },
          { value: 'slack.reaction', weight: 0.07 },
        ], rand);
        metadata = {
          channel_id: channel,
          message_count: randomInt(3, 55, rand),
          reply_count: randomInt(0, 18, rand),
          has_decision_keyword: rand() > 0.58,
          participants: randomInt(2, 9, rand),
        };
      } else if (source === 'jira') {
        const issueKey = pickOne(pools.jiraIssues, rand);
        const issueProject = issueKey.split('-')[0];
        entityId = issueKey;
        eventType = weightedPick([
          { value: 'jira.issue_created', weight: 0.26 },
          { value: 'jira.issue_updated', weight: 0.35 },
          { value: 'jira.issue_reopened', weight: 0.15 },
          { value: 'jira.issue_transitioned', weight: 0.18 },
          { value: 'jira.comment_added', weight: 0.06 },
        ], rand);
        metadata = {
          issue_key: issueKey,
          project_key: issueProject,
          status: pickOne(['To Do', 'In Progress', 'In Review', 'Done'], rand),
          issue_type: pickOne(['Task', 'Story', 'Bug', 'Improvement'], rand),
          assignee: `user_${randomInt(1, 12, rand)}`,
        };
      } else {
        const prEntity = pickOne(pools.githubPrs, rand);
        const { repo, prNumber } = parseGithubEntity(prEntity);
        entityId = prEntity;
        eventType = weightedPick([
          { value: 'github.pr_opened', weight: 0.32 },
          { value: 'github.review_requested', weight: 0.24 },
          { value: 'github.review_submitted', weight: 0.2 },
          { value: 'github.pr_comment', weight: 0.12 },
          { value: 'github.pr_merged', weight: 0.12 },
        ], rand);
        metadata = {
          repo_full_name: repo,
          pr_number: Number.parseInt(prNumber, 10),
          pr_state: pickOne(['open', 'merged', 'closed'], rand),
          author: `dev${randomInt(0, 7, rand)}`,
          reviewer_count: randomInt(1, 4, rand),
        };
      }

      const event: SeedEvent = {
        id: uuid(),
        source,
        entity_id: entityId,
        event_type: eventType,
        timestamp,
        metadata,
        provider_event_id: `${source}_${i + 1}_${uuid()}`,
      };

      await client.query(
        `INSERT INTO events (id, company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (provider_event_id, source, company_id) DO NOTHING`,
        [
          event.id,
          companyId,
          event.source,
          event.entity_id,
          event.event_type,
          event.timestamp,
          JSON.stringify(event.metadata),
          event.provider_event_id,
        ],
      );

      events.push(event);

      const key = `${event.source}:${event.entity_id}`;
      const timestampValue = event.timestamp.getTime();
      const existingTimestamp = eventTimestampByEntity.get(key) || 0;
      if (timestampValue >= existingTimestamp) {
        eventTimestampByEntity.set(key, timestampValue);
        eventIdByEntity.set(key, event.id);
      }
    }
    console.log(`  Events inserted: ${events.length}`);

    const metricSnapshotIds: string[] = [];
    let snapshotCount = 0;

    for (let dayOffset = 0; dayOffset < seedDays; dayOffset++) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - dayOffset);

      const trendProgress = (seedDays - dayOffset) / Math.max(1, seedDays);
      const seasonal = Math.sin((dayOffset / Math.max(1, seedDays)) * Math.PI * 4);

      for (const metric of METRIC_PROFILES) {
        const id = uuid();
        const noise = (rand() - 0.5) * 2 * metric.variance;
        const trendLift = metric.base * metric.trend * trendProgress;
        const seasonalLift = seasonal * metric.variance * 0.24;
        const value = round(Math.max(0.01, metric.base + noise + trendLift + seasonalLift), 3);
        const baseline = round(Math.max(0.01, metric.base + metric.variance * 0.25), 3);

        await client.query(
          `INSERT INTO metric_snapshots (id, company_id, metric_name, scope, value, baseline_value, date, metadata)
           VALUES ($1, $2, $3, 'company', $4, $5, $6, $7)
           ON CONFLICT (company_id, metric_name, scope, scope_id, date) DO NOTHING`,
          [
            id,
            companyId,
            metric.name,
            value,
            baseline,
            date,
            JSON.stringify({ generated_by: 'seed-dev', trend_progress: round(trendProgress, 3) }),
          ],
        );

        metricSnapshotIds.push(id);
        snapshotCount += 1;
      }
    }
    console.log(`  Metric snapshots inserted: ${snapshotCount}`);

    const leaks: SeedLeak[] = [];
    for (let i = 0; i < leakTarget; i++) {
      const leakType = weightedPick(leakTypeWeights, rand);
      const ageDays = randomInt(0, seedDays - 1, rand);
      const detectedAt = makeTimestamp(ageDays, rand);
      const status = leakStatusForAge(ageDays, seedDays, rand);

      const evidenceLinks = buildLeakEvidence(leakType, pools, eventIdByEntity, rand);

      const metricName = LEAK_METRIC_BY_TYPE[leakType];
      const baseline = metricName.includes('rate') || metricName.includes('ratio')
        ? round(clampNumber(0.08 + rand() * 0.2, 0.01, 0.95), 3)
        : round(8 + rand() * 36, 2);
      const currentMultiplier = 1.15 + rand() * 1.45;
      const current = round(baseline * currentMultiplier, 3);
      const deltaPercentage = round(((current - baseline) / Math.max(0.001, baseline)) * 100, 1);

      const recommendedAction = pickOne(ACTIONS_BY_LEAK[leakType], rand);
      const recommendedFix = {
        summary: `Recommended action: ${recommendedAction.replaceAll('_', ' ')}`,
        action_type: recommendedAction,
        details: {
          observed_metric: metricName,
          confidence_band: rand() > 0.4 ? 'medium' : 'high',
        },
      };

      const aiDiagnosis = rand() > 0.28
        ? {
          root_cause: `${leakType.replaceAll('_', ' ')} pattern detected above baseline`,
          confidence: round(0.52 + rand() * 0.44, 2),
          explanation: `This issue has been observed repeatedly over the last ${Math.max(3, Math.floor(seedDays * 0.18))} days and is now outside expected variance.`,
          fix_drafts: [
            {
              description: `Apply ${recommendedAction.replaceAll('_', ' ')} and monitor metric recovery`,
              action_type: recommendedAction,
              details: { metric: metricName },
            },
          ],
        }
        : null;

      const leak: SeedLeak = {
        id: uuid(),
        leak_type: leakType,
        severity: clampNumber(Math.round(32 + rand() * 63), 0, 100),
        confidence: round(0.45 + rand() * 0.5, 2),
        status,
        detected_at: detectedAt,
        evidence_links: evidenceLinks,
        metrics_context: {
          metric_name: metricName,
          current_value: current,
          baseline_value: baseline,
          delta_percentage: deltaPercentage,
        },
        recommended_fix: recommendedFix,
        cost_estimate_hours_per_week: round(2 + rand() * 15, 1),
        ai_diagnosis: aiDiagnosis,
      };

      await client.query(
        `INSERT INTO leak_instances (
           id, company_id, leak_type, severity, confidence, status, detected_at,
           evidence_links, metrics_context, recommended_fix, cost_estimate_hours_per_week, ai_diagnosis
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT DO NOTHING`,
        [
          leak.id,
          companyId,
          leak.leak_type,
          leak.severity,
          leak.confidence,
          leak.status,
          leak.detected_at,
          JSON.stringify(leak.evidence_links),
          JSON.stringify(leak.metrics_context),
          JSON.stringify(leak.recommended_fix),
          leak.cost_estimate_hours_per_week,
          leak.ai_diagnosis ? JSON.stringify(leak.ai_diagnosis) : null,
        ],
      );

      leaks.push(leak);
    }
    console.log(`  Leaks inserted: ${leaks.length}`);

    const commits: SeedCommit[] = [];
    for (let i = 0; i < commitTarget; i++) {
      const type = weightedPick(COMMIT_TYPE_WEIGHTS, rand);
      const topic = pickOne(COMMIT_TOPICS[type], rand);
      const ageDays = clampNumber(
        Math.round(((commitTarget - i) / Math.max(1, commitTarget)) * (seedDays - 1)) + randomInt(-4, 6, rand),
        0,
        seedDays - 1,
      );
      const createdAt = makeTimestamp(ageDays, rand);
      const status = commitStatusForAge(ageDays, seedDays, rand);

      let parentCommitId: string | null = null;
      if (commits.length > 0 && rand() < 0.78) {
        const lookback = Math.min(12, commits.length);
        const parentOffset = randomInt(1, lookback, rand);
        parentCommitId = commits[commits.length - parentOffset].id;
      }

      let linkedLeakId: string | null = null;
      if (leaks.length > 0 && rand() < 0.58) {
        const viableLeaks = leaks.filter((leak) => {
          const leakAgeDays = Math.floor((Date.now() - leak.detected_at.getTime()) / (24 * 3600 * 1000));
          return leakAgeDays >= ageDays;
        });
        const leakSource = viableLeaks.length > 0 ? viableLeaks : leaks;
        linkedLeakId = pickOne(leakSource, rand).id;
      }

      const evidenceCount = randomInt(1, 3, rand);
      const evidenceLinks: EvidenceLink[] = [];
      const usedEvidence = new Set<string>();

      for (let j = 0; j < evidenceCount; j++) {
        let source: EventSource;
        if (linkedLeakId && rand() < 0.6) {
          const leak = leaks.find((item) => item.id === linkedLeakId);
          const primary = leak?.evidence_links[0]?.provider;
          source = (primary as EventSource) || weightedPick(SOURCE_WEIGHTS, rand);
        } else {
          source = weightedPick(SOURCE_WEIGHTS, rand);
        }

        const evidence = buildEvidence(source, pools, eventIdByEntity, rand);
        const dedupeKey = `${evidence.provider}:${evidence.entity_id}`;
        if (usedEvidence.has(dedupeKey)) continue;
        usedEvidence.add(dedupeKey);
        evidenceLinks.push(evidence);
      }

      const title = commitTitle(type, topic, i);
      const summary = `${type.toUpperCase()} update focused on ${topic}.`;
      const rationale = `Created from recent operational signal review for ${topic}.`;
      const dri = pickOne(DRI_POOL, rand);

      const tagPool = [
        ...topic.split(' ').filter((token) => token.length > 3).map((token) => token.toLowerCase()),
        type,
        status,
      ];
      const tags = Array.from(new Set(tagPool)).slice(0, 4);

      const branchName = status === 'merged' || status === 'approved'
        ? 'main'
        : `feature/${slugify(topic)}-${i + 1}`;

      const commit: SeedCommit = {
        id: uuid(),
        commit_type: type,
        title,
        summary,
        rationale,
        dri,
        status,
        branch_name: branchName,
        parent_commit_id: parentCommitId,
        leak_instance_id: linkedLeakId,
        evidence_links: evidenceLinks,
        tags,
        created_at: createdAt,
      };

      await client.query(
        `INSERT INTO ledger_commits (
           id, company_id, commit_type, title, summary, rationale,
           dri, status, branch_name, parent_commit_id,
           evidence_links, tags, leak_instance_id, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14, $14
         )
         ON CONFLICT DO NOTHING`,
        [
          commit.id,
          companyId,
          commit.commit_type,
          commit.title,
          commit.summary,
          commit.rationale,
          commit.dri,
          commit.status,
          commit.branch_name,
          commit.parent_commit_id,
          JSON.stringify(commit.evidence_links),
          commit.tags,
          commit.leak_instance_id,
          commit.created_at,
        ],
      );

      commits.push(commit);
    }
    console.log(`  Commits inserted: ${commits.length}`);

    const actions: SeedAction[] = [];
    for (let i = 0; i < actionTarget; i++) {
      const leak = pickOne(leaks, rand);
      const actionType = pickOne(ACTIONS_BY_LEAK[leak.leak_type], rand);
      const targetSystem = actionSystem(actionType);
      const targetId = inferTargetIdForAction(actionType, leak, pools, rand);
      const status = weightedPick(APPROVAL_STATUS_WEIGHTS, rand);

      const ageDays = Math.floor((Date.now() - leak.detected_at.getTime()) / (24 * 3600 * 1000));
      const createdAt = makeTimestamp(clampNumber(ageDays - randomInt(-3, 8, rand), 0, seedDays - 1), rand);
      const approvedAt = status === 'pending'
        ? null
        : new Date(createdAt.getTime() + randomInt(1, 72, rand) * 3600 * 1000);

      const action: SeedAction = {
        id: uuid(),
        leak_instance_id: leak.id,
        action_type: actionType,
        target_system: targetSystem,
        target_id: targetId,
        preview_diff: {
          description: `Auto-generated ${actionType.replaceAll('_', ' ')} recommendation`,
          after: `Suggested remediation for ${leak.leak_type.replaceAll('_', ' ')} at ${targetId}`,
          structured: {
            leak_type: leak.leak_type,
            target_id: targetId,
            target_system: targetSystem,
          },
        },
        risk_level: weightedPick([
          { value: 'low', weight: 0.55 },
          { value: 'medium', weight: 0.33 },
          { value: 'high', weight: 0.12 },
        ], rand),
        blast_radius: `${targetSystem}:${targetId}`,
        approval_status: status,
        requested_by: rand() > 0.85 ? 'U_DEMO_USER' : 'system',
        approved_by: status === 'pending' ? null : (rand() > 0.7 ? 'U_TEAM_LEAD' : 'U_DEMO_USER'),
        approved_at: approvedAt,
        created_at: createdAt,
      };

      await client.query(
        `INSERT INTO proposed_actions (
           id, company_id, leak_instance_id, action_type, target_system, target_id,
           preview_diff, risk_level, blast_radius, approval_status,
           requested_by, approved_by, approved_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14, $14
         )
         ON CONFLICT DO NOTHING`,
        [
          action.id,
          companyId,
          action.leak_instance_id,
          action.action_type,
          action.target_system,
          action.target_id,
          JSON.stringify(action.preview_diff),
          action.risk_level,
          action.blast_radius,
          action.approval_status,
          action.requested_by,
          action.approved_by,
          action.approved_at,
          action.created_at,
        ],
      );

      actions.push(action);
    }
    console.log(`  Proposed actions inserted: ${actions.length}`);

    let executedActionCount = 0;
    for (const action of actions) {
      if (action.approval_status !== 'executed' && action.approval_status !== 'failed' && action.approval_status !== 'rolled_back') {
        continue;
      }

      const executedAt = action.approved_at
        ? new Date(action.approved_at.getTime() + randomInt(1, 30, rand) * 3600 * 1000)
        : new Date(action.created_at.getTime() + randomInt(2, 24, rand) * 3600 * 1000);

      const result = action.approval_status === 'executed'
        ? (rand() > 0.87 ? 'partial_success' : 'success')
        : action.approval_status === 'rolled_back'
          ? 'rolled_back'
          : 'failure';

      await client.query(
        `INSERT INTO executed_actions (
           id, company_id, proposed_action_id, executed_at, result,
           execution_details, rollback_info, audit_log
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          uuid(),
          companyId,
          action.id,
          executedAt,
          result,
          JSON.stringify({
            action_type: action.action_type,
            target_system: action.target_system,
            target_id: action.target_id,
            run_id: `exec_${uuid()}`,
          }),
          JSON.stringify({
            can_rollback: result === 'success' || result === 'partial_success',
            rollback_type: result === 'rolled_back' ? 'already_rolled_back' : 'delete_or_revert',
            rollback_data: { proposed_action_id: action.id },
          }),
          JSON.stringify([
            { timestamp: action.created_at, action: 'requested', actor: action.requested_by },
            { timestamp: action.approved_at || action.created_at, action: action.approval_status, actor: action.approved_by || 'system' },
            { timestamp: executedAt, action: result, actor: 'system' },
          ]),
        ],
      );

      executedActionCount += 1;
    }
    console.log(`  Executed actions inserted: ${executedActionCount}`);

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

    for (const commit of commits) {
      if (commit.leak_instance_id) {
        pushEdge(commit.id, 'leak_instance', commit.leak_instance_id, 'triggered_by');
      }

      if (commit.parent_commit_id) {
        pushEdge(commit.id, 'ledger_commit', commit.parent_commit_id, 'depends_on');
      }

      for (const evidence of commit.evidence_links) {
        if (!evidence.event_id) continue;
        pushEdge(commit.id, 'event', evidence.event_id, 'references', {
          provider: evidence.provider,
          entity_id: evidence.entity_id,
        });
      }

      if (metricSnapshotIds.length > 0 && rand() < 0.38) {
        pushEdge(commit.id, 'metric_snapshot', pickOne(metricSnapshotIds, rand), 'measured_by');
      }

      if (commits.length > 4 && rand() < 0.16) {
        const related = pickOne(commits, rand);
        if (related.id !== commit.id) {
          pushEdge(commit.id, 'ledger_commit', related.id, 'related_to');
        }
      }

      if (commit.commit_type === 'policy' && commit.parent_commit_id && rand() < 0.4) {
        pushEdge(commit.id, 'ledger_commit', commit.parent_commit_id, 'supersedes');
      }
    }

    const newestCommitByLeak = new Map<string, string>();
    for (const commit of [...commits].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())) {
      if (commit.leak_instance_id && !newestCommitByLeak.has(commit.leak_instance_id)) {
        newestCommitByLeak.set(commit.leak_instance_id, commit.id);
      }
    }

    for (const action of actions) {
      const sourceCommitId = newestCommitByLeak.get(action.leak_instance_id);
      if (!sourceCommitId) continue;
      pushEdge(sourceCommitId, 'proposed_action', action.id, 'resulted_in');
    }

    const commitIdsByLeak = new Map<string, string[]>();
    for (const commit of commits) {
      if (!commit.leak_instance_id) continue;
      if (!commitIdsByLeak.has(commit.leak_instance_id)) {
        commitIdsByLeak.set(commit.leak_instance_id, []);
      }
      commitIdsByLeak.get(commit.leak_instance_id)!.push(commit.id);
    }

    for (const ids of commitIdsByLeak.values()) {
      if (ids.length < 3) continue;
      const root = ids[0];
      const branches = ids.slice(1, Math.min(5, ids.length));
      for (const branchId of branches) {
        if (rand() < 0.55) {
          pushEdge(branchId, 'ledger_commit', root, 'branched_from');
        }
      }
    }

    for (const edge of edgeRows) {
      await client.query(
        `INSERT INTO ledger_edges (company_id, commit_id, target_type, target_id, edge_type, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          companyId,
          edge.commit_id,
          edge.target_type,
          edge.target_id,
          edge.edge_type,
          JSON.stringify(edge.metadata),
        ],
      );
    }
    console.log(`  Ledger edges inserted: ${edgeRows.length}`);

    await client.query('COMMIT');

    console.log('Seed complete.');
    console.log('Summary:');
    console.log(`  company_id=${companyId}`);
    console.log(`  events=${events.length}`);
    console.log(`  metric_snapshots=${snapshotCount}`);
    console.log(`  leak_instances=${leaks.length}`);
    console.log(`  ledger_commits=${commits.length}`);
    console.log(`  proposed_actions=${actions.length}`);
    console.log(`  executed_actions=${executedActionCount}`);
    console.log(`  ledger_edges=${edgeRows.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
