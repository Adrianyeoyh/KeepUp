import { query, withTransaction } from '../db/client.js';
import { logger } from '../logger.js';

type Provider = 'slack' | 'jira' | 'github';
type InferredStatus = 'suggested' | 'confirmed' | 'dismissed' | 'expired';

type SignalName =
  | 'jira_key_in_branch'
  | 'jira_key_in_commit_text'
  | 'github_ref_in_commit_text'
  | 'jira_key_in_slack_text'
  | 'github_ref_in_slack_text'
  | 'cooccurring_commit_evidence'
  | 'temporal_proximity'
  | 'same_mapped_author';

interface InferenceSignal {
  signal: SignalName;
  score: number;
  detail?: Record<string, unknown>;
}

interface EntityRef {
  provider: Provider;
  entityType: string;
  entityId: string;
  teamId: string | null;
  projectId: string | null;
}

interface CandidateLink {
  source: EntityRef;
  target: EntityRef;
  signals: Map<SignalName, InferenceSignal>;
  lastObservedAt: Date;
}

interface CommitRow {
  id: string;
  team_id: string | null;
  project_id: string | null;
  branch_name: string;
  title: string;
  summary: string;
  rationale: string | null;
  created_by: string | null;
  created_at: string;
  evidence_links: unknown;
}

interface EventRow {
  id: string;
  source: Provider;
  entity_id: string;
  event_type: string;
  timestamp: string;
  team_id: string | null;
  project_id: string | null;
  metadata: unknown;
}

interface ProjectRow {
  id: string;
  team_id: string | null;
  slack_channel_ids: unknown;
}

interface UserIdentityRow {
  team_id: string | null;
  slack_user_id: string | null;
  github_username: string | null;
  jira_account_id: string | null;
}

interface ExistingInferredRow {
  source_provider: Provider;
  source_entity_type: string;
  source_entity_id: string;
  target_provider: Provider;
  target_entity_type: string;
  target_entity_id: string;
  status: InferredStatus;
}

interface ExplicitEntityLinkRow {
  source_provider: Provider;
  source_entity_type: string;
  source_entity_id: string;
  target_provider: Provider;
  target_entity_type: string;
  target_entity_id: string;
}

interface InferredLinkUpsert {
  source_provider: Provider;
  source_entity_type: string;
  source_entity_id: string;
  target_provider: Provider;
  target_entity_type: string;
  target_entity_id: string;
  confidence: number;
  inference_reason: InferenceSignal[];
  status: 'suggested';
  team_id: string | null;
}

interface RunInferenceOptions {
  companyId: string;
  teamId?: string;
  projectId?: string;
  dryRun?: boolean;
}

export interface RunInferenceResult {
  dryRun: boolean;
  candidatesEvaluated: number;
  candidatesValid: number;
  upserted: number;
  skippedDismissed: number;
  skippedInvalid: number;
  expiredByScope: number;
  expiredByStaleness: number;
  expiredByCap: number;
}

interface CommitEvidenceEntities {
  github: EntityRef[];
  jira: EntityRef[];
  slack: EntityRef[];
}

interface Activity {
  provider: Provider;
  entityType: string;
  entityId: string;
  teamId: string | null;
  projectId: string | null;
  timestamp: Date;
}

const MAX_TAGS_PER_RUN = 5000;
const MAX_INFERRED_PER_ENTITY = 10;
const TEMPORAL_WINDOW_MINUTES = 240;

const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
const GITHUB_URL_REGEX = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|issues)\/(\d+)/g;
const GITHUB_INLINE_REF_REGEX = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g;

const JIRA_KEY_STOPLIST = new Set<string>([
  'UTF-8',
  'HTTP-404',
  'HTTP-403',
  'HTTP-500',
  'TCP-443',
  'UDP-53',
  'COVID-19',
  'ISO-9001',
  'RFC-7231',
  'IEEE-754',
  'ANSI-16',
  'ASCII-7',
]);

const JIRA_PREFIX_STOPLIST = new Set<string>([
  'UTF',
  'HTTP',
  'TCP',
  'UDP',
  'COVID',
  'ISO',
  'RFC',
  'IEEE',
  'ANSI',
  'ASCII',
  'CVE',
]);

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string | null | undefined): void {
  if (!value) return;
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

function normalizeEntityType(entityType: string | null | undefined): string {
  return (entityType || '').trim().toLowerCase();
}

function buildEntityKey(provider: Provider, entityType: string, entityId: string): string {
  return `${provider}:${normalizeEntityType(entityType)}:${entityId}`;
}

function buildProviderEntityKey(provider: Provider, entityId: string): string {
  return `${provider}:${entityId}`;
}

function safeDate(input: string | Date | undefined): Date {
  const asDate = input instanceof Date ? input : new Date(input || Date.now());
  if (Number.isNaN(asDate.getTime())) return new Date();
  return asDate;
}

function safeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function safeEvidenceArray(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
}

function canonicalizePair(a: EntityRef, b: EntityRef): { source: EntityRef; target: EntityRef } {
  const keyA = `${a.provider}:${a.entityType}:${a.entityId}`;
  const keyB = `${b.provider}:${b.entityType}:${b.entityId}`;
  if (keyA <= keyB) {
    return { source: a, target: b };
  }
  return { source: b, target: a };
}

function candidateKey(source: EntityRef, target: EntityRef): string {
  return `${source.provider}:${source.entityType}:${source.entityId}|${target.provider}:${target.entityType}:${target.entityId}`;
}

function mergeCandidate(
  candidates: Map<string, CandidateLink>,
  a: EntityRef,
  b: EntityRef,
  signal: InferenceSignal,
  observedAt: Date,
): void {
  if (a.provider === b.provider && a.entityType === b.entityType && a.entityId === b.entityId) return;

  const { source, target } = canonicalizePair(a, b);
  const key = candidateKey(source, target);
  const existing = candidates.get(key);

  if (!existing) {
    const signalMap = new Map<SignalName, InferenceSignal>();
    signalMap.set(signal.signal, signal);
    candidates.set(key, {
      source,
      target,
      signals: signalMap,
      lastObservedAt: observedAt,
    });
    return;
  }

  const previousSignal = existing.signals.get(signal.signal);
  if (!previousSignal || previousSignal.score < signal.score) {
    existing.signals.set(signal.signal, signal);
  }
  if (observedAt > existing.lastObservedAt) {
    existing.lastObservedAt = observedAt;
  }
}

function extractJiraKeys(text: string): string[] {
  if (!text) return [];
  const keys = new Set<string>();
  JIRA_KEY_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = JIRA_KEY_REGEX.exec(text)) !== null) {
    const candidate = match[0].toUpperCase();
    const [prefix] = candidate.split('-');

    if (!prefix || prefix.length < 2) continue;
    if (JIRA_KEY_STOPLIST.has(candidate)) continue;
    if (JIRA_PREFIX_STOPLIST.has(prefix)) continue;

    keys.add(candidate);
    if (keys.size > MAX_TAGS_PER_RUN) break;
  }

  return Array.from(keys);
}

function extractGitHubRefs(text: string): Array<{ entityType: string; entityId: string; repo: string }> {
  if (!text) return [];
  const refs: Array<{ entityType: string; entityId: string; repo: string }> = [];
  const seen = new Set<string>();

  GITHUB_URL_REGEX.lastIndex = 0;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = GITHUB_URL_REGEX.exec(text)) !== null) {
    const repo = urlMatch[1];
    const type = urlMatch[2] === 'pull' ? 'pr' : 'issue';
    const number = urlMatch[3];
    const entityId = `${repo}#${number}`;
    const key = `${type}:${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ entityType: type, entityId, repo });
  }

  GITHUB_INLINE_REF_REGEX.lastIndex = 0;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = GITHUB_INLINE_REF_REGEX.exec(text)) !== null) {
    const repo = inlineMatch[1];
    const entityId = `${repo}#${inlineMatch[2]}`;
    const key = `issue:${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ entityType: 'issue', entityId, repo });
  }

  return refs;
}

function extractActorsForEvent(source: Provider, metadata: Record<string, unknown>): string[] {
  const actors = new Set<string>();

  const pick = (key: string) => {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      actors.add(value.trim());
    }
  };

  if (source === 'slack') {
    pick('user_id');
    pick('inviter_id');
  }

  if (source === 'github') {
    pick('author');
    pick('commenter');
    pick('reviewer');
    pick('requested_reviewer');
  }

  if (source === 'jira') {
    pick('assignee');
    pick('author');
  }

  return Array.from(actors);
}

function temporalScore(deltaMinutes: number): number {
  if (deltaMinutes <= 5) return 0.95;
  if (deltaMinutes <= 120) return 0.6;
  return 0.4;
}

function normalizeConfidence(signals: InferenceSignal[]): number {
  if (signals.length === 0) return 0;

  const maxSignal = Math.max(...signals.map((signal) => signal.score));
  const multiSignalBonus = Math.min(0.12, Math.max(0, signals.length - 1) * 0.04);
  return Math.max(0, Math.min(0.99, maxSignal + multiSignalBonus));
}

function hasHighStandaloneSignal(signals: InferenceSignal[]): boolean {
  return signals.some(
    (signal) =>
      signal.signal === 'jira_key_in_branch'
      || signal.signal === 'jira_key_in_commit_text'
      || signal.signal === 'cooccurring_commit_evidence',
  );
}

function providerToDefaultEntityType(provider: Provider, entityId: string): string {
  if (provider === 'jira') return 'issue';
  if (provider === 'slack') return entityId.includes(':') ? 'thread' : 'channel';
  if (provider === 'github') return entityId.includes('#') ? 'pr' : 'repo';
  return '';
}

async function loadCommits(
  companyId: string,
  teamId?: string,
  projectId?: string,
): Promise<CommitRow[]> {
  const params: unknown[] = [companyId];
  let whereClause = 'WHERE company_id = $1';

  if (teamId) {
    params.push(teamId);
    whereClause += ` AND team_id = $${params.length}`;
  }

  if (projectId) {
    params.push(projectId);
    whereClause += ` AND project_id = $${params.length}`;
  }

  const result = await query<CommitRow>(
    `SELECT
      id,
      team_id,
      project_id,
      branch_name,
      title,
      summary,
      rationale,
      created_by,
      created_at,
      evidence_links
     FROM ledger_commits
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 3000`,
    params,
  );

  return result.rows;
}

async function loadEvents(
  companyId: string,
  teamId?: string,
  projectId?: string,
): Promise<EventRow[]> {
  const params: unknown[] = [companyId];
  let whereClause = 'WHERE company_id = $1';

  if (teamId) {
    params.push(teamId);
    whereClause += ` AND team_id = $${params.length}`;
  }

  if (projectId) {
    params.push(projectId);
    whereClause += ` AND project_id = $${params.length}`;
  }

  const result = await query<EventRow>(
    `SELECT
      id,
      source,
      entity_id,
      event_type,
      timestamp,
      team_id,
      project_id,
      metadata
     FROM events
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT 6000`,
    params,
  );

  return result.rows;
}

async function loadProjects(companyId: string, teamId?: string, projectId?: string): Promise<ProjectRow[]> {
  const params: unknown[] = [companyId];
  let whereClause = 'WHERE company_id = $1';

  if (teamId) {
    params.push(teamId);
    whereClause += ` AND team_id = $${params.length}`;
  }

  if (projectId) {
    params.push(projectId);
    whereClause += ` AND id = $${params.length}`;
  }

  const result = await query<ProjectRow>(
    `SELECT id, team_id, slack_channel_ids FROM projects ${whereClause}`,
    params,
  );

  return result.rows;
}

function buildAllowedSlackChannels(projects: ProjectRow[]): Map<string, Set<string>> {
  const byTeam = new Map<string, Set<string>>();

  for (const project of projects) {
    if (!project.team_id) continue;

    if (!Array.isArray(project.slack_channel_ids)) continue;

    const normalizedChannels = (project.slack_channel_ids as unknown[])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toUpperCase());

    if (normalizedChannels.length === 0) continue;

    let teamSet = byTeam.get(project.team_id);
    if (!teamSet) {
      teamSet = new Set<string>();
      byTeam.set(project.team_id, teamSet);
    }

    for (const channel of normalizedChannels) {
      teamSet.add(channel);
    }
  }

  return byTeam;
}

function isAllowedSlackChannel(
  channelId: string | null,
  teamId: string | null,
  allowedChannelsByTeam: Map<string, Set<string>>,
): boolean {
  if (!channelId) return false;
  const normalizedChannel = channelId.toUpperCase();

  if (teamId) {
    const allowed = allowedChannelsByTeam.get(teamId);
    if (!allowed || allowed.size === 0) return true;
    return allowed.has(normalizedChannel);
  }

  for (const allowed of allowedChannelsByTeam.values()) {
    if (allowed.has(normalizedChannel)) return true;
  }

  // If no allowlist is configured at all, permit channel-based scanning.
  return allowedChannelsByTeam.size === 0;
}

export async function runInferenceEngine(options: RunInferenceOptions): Promise<RunInferenceResult> {
  const { companyId, teamId, projectId, dryRun = false } = options;

  const [commits, events, projects] = await Promise.all([
    loadCommits(companyId, teamId, projectId),
    loadEvents(companyId, teamId, projectId),
    loadProjects(companyId, teamId, projectId),
  ]);

  const allowedSlackChannelsByTeam = buildAllowedSlackChannels(projects);

  const candidates = new Map<string, CandidateLink>();
  const knownEntitiesByTypedKey = new Set<string>();
  const knownEntitiesByProviderId = new Set<string>();
  const knownEntityTeamsByProviderId = new Map<string, Set<string>>();
  const knownEntityProjectsByProviderId = new Map<string, Set<string>>();
  const commitEvidenceMap = new Map<string, CommitEvidenceEntities>();

  for (const event of events) {
    const defaultType = providerToDefaultEntityType(event.source, event.entity_id);
    const providerEntityKey = buildProviderEntityKey(event.source, event.entity_id);
    knownEntitiesByTypedKey.add(buildEntityKey(event.source, defaultType, event.entity_id));
    knownEntitiesByProviderId.add(providerEntityKey);
    addToSetMap(knownEntityTeamsByProviderId, providerEntityKey, event.team_id);
    addToSetMap(knownEntityProjectsByProviderId, providerEntityKey, event.project_id);
  }

  for (const commit of commits) {
    const evidenceEntities: CommitEvidenceEntities = {
      github: [],
      jira: [],
      slack: [],
    };

    for (const rawLink of safeEvidenceArray(commit.evidence_links)) {
      const provider = rawLink.provider;
      const entityId = rawLink.entity_id;
      const entityType = rawLink.entity_type;

      if (provider !== 'github' && provider !== 'jira' && provider !== 'slack') continue;
      if (typeof entityId !== 'string' || entityId.trim().length === 0) continue;

      const normalizedType = normalizeEntityType(typeof entityType === 'string' ? entityType : '');
      const ref: EntityRef = {
        provider,
        entityType: normalizedType || providerToDefaultEntityType(provider, entityId),
        entityId,
        teamId: commit.team_id,
        projectId: commit.project_id,
      };

      evidenceEntities[provider].push(ref);
      knownEntitiesByTypedKey.add(buildEntityKey(provider, ref.entityType, entityId));
      knownEntitiesByProviderId.add(buildProviderEntityKey(provider, entityId));
    }

    commitEvidenceMap.set(commit.id, evidenceEntities);
  }

  // Strategy 0: co-occurring evidence entities within the same commit
  // This gives a high-confidence fallback when text/branch conventions are absent.
  for (const commit of commits) {
    const evidence = commitEvidenceMap.get(commit.id);
    if (!evidence) continue;

    const flattened = [
      ...evidence.github,
      ...evidence.jira,
      ...evidence.slack,
    ];

    if (flattened.length < 2) continue;

    const uniqueByRef = new Map<string, EntityRef>();
    for (const ref of flattened) {
      const key = `${ref.provider}:${ref.entityType}:${ref.entityId}`;
      if (!uniqueByRef.has(key)) {
        uniqueByRef.set(key, ref);
      }
    }

    const refs = Array.from(uniqueByRef.values());
    const observedAt = safeDate(commit.created_at);

    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const a = refs[i];
        const b = refs[j];
        if (a.provider === b.provider) continue;

        let score = 0.8;
        const pairKey = [a.provider, b.provider].sort().join(':');
        if (pairKey === 'github:jira') score = 0.86;
        if (pairKey === 'jira:slack') score = 0.83;
        if (pairKey === 'github:slack') score = 0.81;

        mergeCandidate(
          candidates,
          a,
          b,
          {
            signal: 'cooccurring_commit_evidence',
            score,
            detail: { commit_id: commit.id, pair: pairKey },
          },
          observedAt,
        );
      }
    }
  }

  // Strategy 1: branch naming conventions (high-confidence)
  for (const commit of commits) {
    const evidence = commitEvidenceMap.get(commit.id);
    if (!evidence || evidence.github.length === 0) continue;

    const jiraKeys = extractJiraKeys(commit.branch_name || '');
    if (jiraKeys.length === 0) continue;

    for (const jiraKey of jiraKeys) {
      const jiraTarget: EntityRef = {
        provider: 'jira',
        entityType: 'issue',
        entityId: jiraKey,
        teamId: commit.team_id,
        projectId: commit.project_id,
      };

      for (const githubSource of evidence.github) {
        mergeCandidate(
          candidates,
          githubSource,
          jiraTarget,
          {
            signal: 'jira_key_in_branch',
            score: 0.95,
            detail: { branch_name: commit.branch_name, jira_key: jiraKey },
          },
          safeDate(commit.created_at),
        );
      }
    }
  }

  // Strategy 2: commit text scanning
  for (const commit of commits) {
    const evidence = commitEvidenceMap.get(commit.id);
    if (!evidence) continue;

    const corpus = [
      commit.title || '',
      commit.summary || '',
      commit.rationale || '',
      commit.branch_name || '',
    ].join(' ');

    const jiraKeys = extractJiraKeys(corpus);
    const githubRefs = extractGitHubRefs(corpus);
    const observedAt = safeDate(commit.created_at);

    for (const jiraKey of jiraKeys) {
      const jiraTarget: EntityRef = {
        provider: 'jira',
        entityType: 'issue',
        entityId: jiraKey,
        teamId: commit.team_id,
        projectId: commit.project_id,
      };

      for (const githubSource of evidence.github) {
        mergeCandidate(
          candidates,
          githubSource,
          jiraTarget,
          {
            signal: 'jira_key_in_commit_text',
            score: 0.88,
            detail: { commit_id: commit.id, jira_key: jiraKey },
          },
          observedAt,
        );
      }

      for (const slackSource of evidence.slack) {
        mergeCandidate(
          candidates,
          slackSource,
          jiraTarget,
          {
            signal: 'jira_key_in_commit_text',
            score: 0.8,
            detail: { commit_id: commit.id, jira_key: jiraKey },
          },
          observedAt,
        );
      }
    }

    if (evidence.jira.length > 0 && githubRefs.length > 0) {
      for (const githubRef of githubRefs) {
        const githubTarget: EntityRef = {
          provider: 'github',
          entityType: githubRef.entityType,
          entityId: githubRef.entityId,
          teamId: commit.team_id,
          projectId: commit.project_id,
        };

        for (const jiraSource of evidence.jira) {
          mergeCandidate(
            candidates,
            jiraSource,
            githubTarget,
            {
              signal: 'github_ref_in_commit_text',
              score: 0.83,
              detail: { commit_id: commit.id, github_ref: githubRef.entityId },
            },
            observedAt,
          );
        }
      }
    }
  }

  // Strategy 3: Slack text scanning with channel allowlist enforcement
  for (const event of events) {
    if (event.source !== 'slack') continue;

    const metadata = safeMetadata(event.metadata);
    const channelId = typeof metadata.channel_id === 'string' ? metadata.channel_id : null;

    if (!isAllowedSlackChannel(channelId, event.team_id, allowedSlackChannelsByTeam)) {
      continue;
    }

    const corpus = [
      typeof metadata.text === 'string' ? metadata.text : '',
      typeof metadata.message_text === 'string' ? metadata.message_text : '',
      typeof metadata.previous_text === 'string' ? metadata.previous_text : '',
      typeof metadata.new_text === 'string' ? metadata.new_text : '',
    ].join(' ');

    if (!corpus.trim()) continue;

    const sourceRef: EntityRef = {
      provider: 'slack',
      entityType: 'thread',
      entityId: event.entity_id,
      teamId: event.team_id,
      projectId: event.project_id,
    };

    const observedAt = safeDate(event.timestamp);

    for (const jiraKey of extractJiraKeys(corpus)) {
      const jiraTarget: EntityRef = {
        provider: 'jira',
        entityType: 'issue',
        entityId: jiraKey,
        teamId: event.team_id,
        projectId: event.project_id,
      };

      mergeCandidate(
        candidates,
        sourceRef,
        jiraTarget,
        {
          signal: 'jira_key_in_slack_text',
          score: 0.78,
          detail: { event_id: event.id, jira_key: jiraKey, channel_id: channelId },
        },
        observedAt,
      );
    }

    for (const githubRef of extractGitHubRefs(corpus)) {
      const githubTarget: EntityRef = {
        provider: 'github',
        entityType: githubRef.entityType,
        entityId: githubRef.entityId,
        teamId: event.team_id,
        projectId: event.project_id,
      };

      mergeCandidate(
        candidates,
        sourceRef,
        githubTarget,
        {
          signal: 'github_ref_in_slack_text',
          score: 0.8,
          detail: { event_id: event.id, github_ref: githubRef.entityId, channel_id: channelId },
        },
        observedAt,
      );
    }
  }

  // Strategy 4: temporal + author correlation
  let identityRows: UserIdentityRow[] = [];
  try {
    const params: unknown[] = [];
    let whereClause = '';
    if (teamId) {
      params.push(teamId);
      whereClause = `WHERE team_id = $1`;
    }

    const identityResult = await query<UserIdentityRow>(
      `SELECT team_id, slack_user_id, github_username, jira_account_id
       FROM user_identity_map
       ${whereClause}`,
      params,
    );

    identityRows = identityResult.rows;
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err
      ? (err as { code?: string }).code
      : undefined;
    if (code !== '42P01') {
      throw err;
    }

    logger.warn('user_identity_map table not found yet; skipping temporal+author strategy');
  }

  if (identityRows.length > 0) {
    const identityBySlack = new Map<string, UserIdentityRow[]>();
    const identityByGithub = new Map<string, UserIdentityRow[]>();
    const identityByJira = new Map<string, UserIdentityRow[]>();

    for (const identity of identityRows) {
      if (identity.slack_user_id) {
        const list = identityBySlack.get(identity.slack_user_id) || [];
        list.push(identity);
        identityBySlack.set(identity.slack_user_id, list);
      }
      if (identity.github_username) {
        const list = identityByGithub.get(identity.github_username) || [];
        list.push(identity);
        identityByGithub.set(identity.github_username, list);
      }
      if (identity.jira_account_id) {
        const list = identityByJira.get(identity.jira_account_id) || [];
        list.push(identity);
        identityByJira.set(identity.jira_account_id, list);
      }
    }

    const activityByIdentity = new Map<string, Activity[]>();

    for (const event of events) {
      const metadata = safeMetadata(event.metadata);
      const actors = extractActorsForEvent(event.source, metadata);
      if (actors.length === 0) continue;

      for (const actor of actors) {
        let identities: UserIdentityRow[] = [];
        if (event.source === 'slack') identities = identityBySlack.get(actor) || [];
        if (event.source === 'github') identities = identityByGithub.get(actor) || [];
        if (event.source === 'jira') identities = identityByJira.get(actor) || [];

        if (identities.length === 0) continue;

        for (const identity of identities) {
          if (identity.team_id && event.team_id && identity.team_id !== event.team_id) {
            continue;
          }

          const identityKey = `${identity.team_id || 'global'}:${identity.slack_user_id || '-'}:${identity.github_username || '-'}:${identity.jira_account_id || '-'}`;
          const activities = activityByIdentity.get(identityKey) || [];
          activities.push({
            provider: event.source,
            entityType: providerToDefaultEntityType(event.source, event.entity_id),
            entityId: event.entity_id,
            teamId: event.team_id,
            projectId: event.project_id,
            timestamp: safeDate(event.timestamp),
          });
          activityByIdentity.set(identityKey, activities);
        }
      }
    }

    for (const activities of activityByIdentity.values()) {
      activities.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      for (let i = 0; i < activities.length; i++) {
        const current = activities[i];
        for (let j = i + 1; j < activities.length; j++) {
          const next = activities[j];
          if (current.provider === next.provider) continue;

          const deltaMinutes = Math.abs(next.timestamp.getTime() - current.timestamp.getTime()) / 60000;
          if (deltaMinutes > TEMPORAL_WINDOW_MINUTES) break;

          const currentRef: EntityRef = {
            provider: current.provider,
            entityType: current.entityType,
            entityId: current.entityId,
            teamId: current.teamId,
            projectId: current.projectId,
          };
          const nextRef: EntityRef = {
            provider: next.provider,
            entityType: next.entityType,
            entityId: next.entityId,
            teamId: next.teamId,
            projectId: next.projectId,
          };

          const observedAt = next.timestamp > current.timestamp ? next.timestamp : current.timestamp;

          mergeCandidate(
            candidates,
            currentRef,
            nextRef,
            {
              signal: 'temporal_proximity',
              score: temporalScore(deltaMinutes),
              detail: { delta_minutes: Math.round(deltaMinutes) },
            },
            observedAt,
          );

          mergeCandidate(
            candidates,
            currentRef,
            nextRef,
            {
              signal: 'same_mapped_author',
              score: 0.72,
              detail: { correlation: 'identity_map' },
            },
            observedAt,
          );
        }
      }
    }
  }

  // Gather existing dismissed links so they are never re-suggested.
  const existingResult = await query<ExistingInferredRow>(
    `SELECT
      source_provider,
      source_entity_type,
      source_entity_id,
      target_provider,
      target_entity_type,
      target_entity_id,
      status
     FROM inferred_links
     WHERE company_id = $1`,
    [companyId],
  );

  const dismissedKeys = new Set<string>();
  for (const row of existingResult.rows) {
    if (row.status !== 'dismissed') continue;

    const source: EntityRef = {
      provider: row.source_provider,
      entityType: normalizeEntityType(row.source_entity_type),
      entityId: row.source_entity_id,
      teamId: null,
      projectId: null,
    };
    const target: EntityRef = {
      provider: row.target_provider,
      entityType: normalizeEntityType(row.target_entity_type),
      entityId: row.target_entity_id,
      teamId: null,
      projectId: null,
    };

    const canonical = canonicalizePair(source, target);
    dismissedKeys.add(candidateKey(canonical.source, canonical.target));
  }

  const explicitLinksResult = await query<ExplicitEntityLinkRow>(
    `SELECT
      source_provider,
      source_entity_type,
      source_entity_id,
      target_provider,
      target_entity_type,
      target_entity_id
     FROM entity_links
     WHERE company_id = $1`,
    [companyId],
  );

  const explicitPairKeys = new Set<string>();
  for (const row of explicitLinksResult.rows) {
    const source: EntityRef = {
      provider: row.source_provider,
      entityType: normalizeEntityType(row.source_entity_type),
      entityId: row.source_entity_id,
      teamId: null,
      projectId: null,
    };
    const target: EntityRef = {
      provider: row.target_provider,
      entityType: normalizeEntityType(row.target_entity_type),
      entityId: row.target_entity_id,
      teamId: null,
      projectId: null,
    };

    const canonical = canonicalizePair(source, target);
    explicitPairKeys.add(candidateKey(canonical.source, canonical.target));
  }

  let skippedDismissed = 0;
  let skippedInvalid = 0;
  const upserts: InferredLinkUpsert[] = [];

  for (const candidate of candidates.values()) {
    const signals = Array.from(candidate.signals.values());
    if (signals.length === 0) {
      skippedInvalid += 1;
      continue;
    }

    const canonical = canonicalizePair(candidate.source, candidate.target);
    const key = candidateKey(canonical.source, canonical.target);

    if (dismissedKeys.has(key)) {
      skippedDismissed += 1;
      continue;
    }

    if (explicitPairKeys.has(key)) {
      skippedInvalid += 1;
      continue;
    }

    const sourceProviderKey = buildProviderEntityKey(canonical.source.provider, canonical.source.entityId);
    const targetProviderKey = buildProviderEntityKey(canonical.target.provider, canonical.target.entityId);

    const sourceTeamScope = new Set<string>(knownEntityTeamsByProviderId.get(sourceProviderKey) || []);
    const targetTeamScope = new Set<string>(knownEntityTeamsByProviderId.get(targetProviderKey) || []);
    if (sourceTeamScope.size === 0 && canonical.source.teamId) sourceTeamScope.add(canonical.source.teamId);
    if (targetTeamScope.size === 0 && canonical.target.teamId) targetTeamScope.add(canonical.target.teamId);

    if (sourceTeamScope.size > 0 && targetTeamScope.size > 0) {
      const hasTeamOverlap = Array.from(sourceTeamScope).some((team) => targetTeamScope.has(team));
      if (!hasTeamOverlap) {
        skippedInvalid += 1;
        continue;
      }
    }

    const sourceProjectScope = new Set<string>(knownEntityProjectsByProviderId.get(sourceProviderKey) || []);
    const targetProjectScope = new Set<string>(knownEntityProjectsByProviderId.get(targetProviderKey) || []);
    if (sourceProjectScope.size === 0 && canonical.source.projectId) sourceProjectScope.add(canonical.source.projectId);
    if (targetProjectScope.size === 0 && canonical.target.projectId) targetProjectScope.add(canonical.target.projectId);

    if (sourceProjectScope.size > 0 && targetProjectScope.size > 0) {
      const hasProjectOverlap = Array.from(sourceProjectScope).some((project) => targetProjectScope.has(project));
      if (!hasProjectOverlap) {
        skippedInvalid += 1;
        continue;
      }
    }

    const sourceExists =
      knownEntitiesByTypedKey.has(buildEntityKey(canonical.source.provider, canonical.source.entityType, canonical.source.entityId)) ||
      knownEntitiesByProviderId.has(buildProviderEntityKey(canonical.source.provider, canonical.source.entityId));
    const targetExists =
      knownEntitiesByTypedKey.has(buildEntityKey(canonical.target.provider, canonical.target.entityType, canonical.target.entityId)) ||
      knownEntitiesByProviderId.has(buildProviderEntityKey(canonical.target.provider, canonical.target.entityId));

    if (!sourceExists || !targetExists) {
      skippedInvalid += 1;
      continue;
    }

    let confidence = normalizeConfidence(signals);
    const hasStandaloneSignal = hasHighStandaloneSignal(signals);

    if (!hasStandaloneSignal && signals.length < 2) {
      confidence = Math.min(confidence, 0.3);
    }

    if (confidence <= 0.05) {
      skippedInvalid += 1;
      continue;
    }

    upserts.push({
      source_provider: canonical.source.provider,
      source_entity_type: canonical.source.entityType,
      source_entity_id: canonical.source.entityId,
      target_provider: canonical.target.provider,
      target_entity_type: canonical.target.entityType,
      target_entity_id: canonical.target.entityId,
      confidence,
      inference_reason: signals,
      status: 'suggested',
      team_id: canonical.source.teamId || canonical.target.teamId || null,
    });
  }

  let upserted = 0;
  let expiredByScope = 0;
  let expiredByStaleness = 0;
  let expiredByCap = 0;

  if (!dryRun && upserts.length > 0) {
    await withTransaction(async (client) => {
      for (const row of upserts) {
        const result = await client.query(
          `INSERT INTO inferred_links (
            company_id,
            source_provider,
            source_entity_type,
            source_entity_id,
            target_provider,
            target_entity_type,
            target_entity_id,
            confidence,
            inference_reason,
            status,
            team_id,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW()
          )
          ON CONFLICT (
            company_id,
            source_provider,
            source_entity_type,
            source_entity_id,
            target_provider,
            target_entity_type,
            target_entity_id
          )
          DO UPDATE SET
            confidence = EXCLUDED.confidence,
            inference_reason = EXCLUDED.inference_reason,
            status = CASE
              WHEN inferred_links.status = 'confirmed' THEN inferred_links.status
              WHEN inferred_links.status = 'dismissed' THEN inferred_links.status
              ELSE EXCLUDED.status
            END,
            team_id = COALESCE(inferred_links.team_id, EXCLUDED.team_id),
            updated_at = NOW()
          RETURNING id`,
          [
            companyId,
            row.source_provider,
            row.source_entity_type,
            row.source_entity_id,
            row.target_provider,
            row.target_entity_type,
            row.target_entity_id,
            row.confidence,
            JSON.stringify(row.inference_reason),
            row.status,
            row.team_id,
          ],
        );

        if ((result.rowCount || 0) > 0) {
          upserted += 1;
        }
      }

      const scopeResult = await client.query(
        `WITH entity_team AS (
           SELECT
             source AS provider,
             entity_id,
             CASE WHEN COUNT(DISTINCT team_id) = 1 THEN MIN(team_id::text) ELSE NULL END AS team_id
           FROM events
           WHERE company_id = $1
             AND team_id IS NOT NULL
           GROUP BY source, entity_id
         ),
         entity_project AS (
           SELECT
             source AS provider,
             entity_id,
             CASE WHEN COUNT(DISTINCT project_id) = 1 THEN MIN(project_id::text) ELSE NULL END AS project_id
           FROM events
           WHERE company_id = $1
             AND project_id IS NOT NULL
           GROUP BY source, entity_id
         )
         UPDATE inferred_links il
         SET status = 'expired', updated_at = NOW()
         WHERE il.company_id = $1
           AND il.status = 'suggested'
           AND (
             EXISTS (
               SELECT 1
               FROM entity_team s
               JOIN entity_team t
                 ON t.provider = il.target_provider
                AND t.entity_id = il.target_entity_id
               WHERE s.provider = il.source_provider
                 AND s.entity_id = il.source_entity_id
                 AND s.team_id IS NOT NULL
                 AND t.team_id IS NOT NULL
                 AND s.team_id <> t.team_id
             )
             OR EXISTS (
               SELECT 1
               FROM entity_project s
               JOIN entity_project t
                 ON t.provider = il.target_provider
                AND t.entity_id = il.target_entity_id
               WHERE s.provider = il.source_provider
                 AND s.entity_id = il.source_entity_id
                 AND s.project_id IS NOT NULL
                 AND t.project_id IS NOT NULL
                 AND s.project_id <> t.project_id
             )
           )`,
        [companyId],
      );
      expiredByScope = scopeResult.rowCount || 0;

      const staleResult = await client.query(
        `UPDATE inferred_links
         SET status = 'expired', updated_at = NOW()
         WHERE company_id = $1
           AND status = 'suggested'
           AND confidence >= 0.6
           AND confidence < 0.85
           AND created_at < NOW() - INTERVAL '30 days'`,
        [companyId],
      );
      expiredByStaleness = staleResult.rowCount || 0;

      const cappedResult = await client.query(
        `WITH ranked AS (
           SELECT
             id,
             ROW_NUMBER() OVER (
               PARTITION BY source_provider, source_entity_type, source_entity_id
               ORDER BY confidence DESC, created_at DESC
             ) AS rn
           FROM inferred_links
           WHERE company_id = $1
             AND status = 'suggested'
         )
         UPDATE inferred_links i
         SET status = 'expired', updated_at = NOW()
         FROM ranked r
         WHERE i.id = r.id
           AND r.rn > $2`,
        [companyId, MAX_INFERRED_PER_ENTITY],
      );
      expiredByCap = cappedResult.rowCount || 0;
    });
  }

  const result: RunInferenceResult = {
    dryRun,
    candidatesEvaluated: candidates.size,
    candidatesValid: upserts.length,
    upserted: dryRun ? upserts.length : upserted,
    skippedDismissed,
    skippedInvalid,
    expiredByScope,
    expiredByStaleness,
    expiredByCap,
  };

  logger.info({ result, companyId, teamId, projectId }, 'Inference engine run completed');
  return result;
}
