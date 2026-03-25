import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TreeCommit, TreeTeam, TreeLeak } from "./GitLedgerTree";
import { EvidenceCard } from "@/components/EvidenceCard";
import { apiFetch } from "@/lib/api";

interface GraphNode {
  id: string;
  type: "commit" | "leak" | "team" | "jira" | "slack" | "github";
  label: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  teamId: string | null;
  homeX: number;
  homeY: number;
  entity?: LedgerEntity;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "belongs_to" | "triggered_by" | "depends_on" | "owned_by" | "linked_entity" | "inferred_link";
  curveOffset: number;
  isCrossTeam: boolean;
  inferredLinkId?: string;
  inferredConfidence?: number;
  inferredTier?: "explicit" | "strong" | "medium" | "weak";
  inferredReason?: unknown;
  inferredStatus?: "suggested" | "confirmed" | "dismissed" | "expired";
}

interface RawGraphEdge {
  source: string;
  target: string;
  type: GraphEdge["type"];
  sourceTeam: string | null;
  targetTeam: string | null;
  inferredLinkId?: string;
  inferredConfidence?: number;
  inferredTier?: "explicit" | "strong" | "medium" | "weak";
  inferredReason?: unknown;
  inferredStatus?: "suggested" | "confirmed" | "dismissed" | "expired";
}

interface TeamBand {
  teamId: string;
  label: string;
  color: string;
  startX: number;
  endX: number;
}

interface FocusSummary {
  commits: number;
  leaks: number;
  teams: number;
  jira: number;
  slack: number;
  github: number;
}

export interface LedgerEntity {
  provider: "jira" | "slack" | "github";
  entity_type: string | null;
  entity_id: string;
  url: string | null;
  title: string | null;
  commit_ids: string[];
  team_ids: string[];
}

export interface InferredLink {
  id: string;
  source_provider: "jira" | "slack" | "github";
  source_entity_type: string | null;
  source_entity_id: string;
  target_provider: "jira" | "slack" | "github";
  target_entity_type: string | null;
  target_entity_id: string;
  confidence: number;
  confidence_tier: "explicit" | "strong" | "medium" | "weak";
  inference_reason: unknown;
  status: "suggested" | "confirmed" | "dismissed" | "expired";
  team_id: string | null;
  created_at: string;
}

interface DragState {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
}

interface CanvasPanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  moved: boolean;
}

export interface GraphFilterState {
  typeFilter: string;
  statusFilter: string;
  branchFilter: string;
  jiraKeyFilter: string;
  prFilter: string;
  slackChannelFilter: string;
  tagFilters: string[];
  dateFrom: string;
  dateTo: string;
}

interface ForceDirectedGraphProps {
  commits: TreeCommit[];
  teams: TreeTeam[];
  leaks: TreeLeak[];
  entities?: LedgerEntity[];
  inferredLinks?: InferredLink[];
  teamId?: string | null;
  projectId?: string | null;
  filterState?: GraphFilterState;
}

interface TraversalStateSnapshot {
  lockedFocusIds: string[];
  lastLockedId: string | null;
  multiFocusEnabled: boolean;
  focusDepth: 1 | 2;
  showJiraEntities: boolean;
  showSlackEntities: boolean;
  showGithubEntities: boolean;
  navigationLockEnabled: boolean;
  zoom: number;
  zoomOffsetX?: number;
  zoomOffsetY?: number;
  density: number;
}

interface RouteSnapshotV1 {
  version: 1;
  datasetSignature: string;
  traversal: TraversalStateSnapshot;
  nodePositions: Record<string, { x: number; y: number }>;
  capturedAt: string;
}

interface SavedRouteEntry {
  id: string;
  name: string;
  solutionDraft: string;
  createdAt: string;
  snapshot: RouteSnapshotV1;
}

interface SavedRouteApiRow {
  id: string;
  name: string;
  solution_draft: string | null;
  created_at: string;
  snapshot: RouteSnapshotV1;
}

const DEFAULT_WIDTH = 1800;
const DEFAULT_HEIGHT = 1200;
const TEAM_LAYER_RATIO = 0.12;
const COMMIT_LAYER_RATIO = 0.44;
const ENTITY_LAYER_RATIO = 0.7;
const LEAK_LAYER_RATIO = 0.86;
const REPULSION = 250;
const EDGE_PULL = 0.014;
const DAMPING = 0.88;
const ITERATIONS = 340;
const HOME_PULL_X = 0.03;
const HOME_PULL_Y = 0.055;
const TEAM_ANCHOR_PULL_X = 0.09;
const TEAM_ANCHOR_PULL_Y = 0.14;
const COLLISION_PADDING = 6;
const MAX_LOCKS_FOR_FULL_DEPTH = 3;
const MAX_VISIBLE_ENTITY_NODES = 50;
const GRAPH_AUTOSAVE_KEY = "flowguard.ledger.graph.autosave.v1";
const MAX_SAVED_ROUTES = 40;
const MIN_GRAPH_WIDTH = 1600;
const MIN_GRAPH_HEIGHT = 1100;
const MAX_GRAPH_HEIGHT = 3600;
const SANDBOX_SCALE = 2.6;
const CANVAS_PAN_THRESHOLD_PX = 5;
const TEAM_LANE_TARGET_WIDTH = 420;
const NODE_WIDTH_PRESSURE = 28;
const NODE_HEIGHT_PRESSURE = 34;
const G_FIT_PADDING = 40;
const G_FIT_MIN_SCALE = 0.9;
const G_FIT_MAX_SCALE = 2.8;
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 2.4;
const DEFAULT_ZOOM = ZOOM_MIN;

function seededUnit(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function seededBetween(id: string, min: number, max: number): number {
  return min + seededUnit(id) * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeGraphFitTransform(nodes: GraphNode[], width: number, height: number): {
  scale: number;
  translateX: number;
  translateY: number;
} {
  if (nodes.length === 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, width - G_FIT_PADDING * 2);
  const availableHeight = Math.max(1, height - G_FIT_PADDING * 2);

  const fitScale = clamp(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
    G_FIT_MIN_SCALE,
    G_FIT_MAX_SCALE,
  );

  const scaledWidth = contentWidth * fitScale;
  const scaledHeight = contentHeight * fitScale;
  const translateX = (width - scaledWidth) / 2 - minX * fitScale;
  const translateY = (height - scaledHeight) / 2 - minY * fitScale;

  return {
    scale: fitScale,
    translateX,
    translateY,
  };
}

function cloneNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => ({ ...node }));
}

interface NeighborhoodOptions {
  stopAtTeamHubs?: boolean;
  nodeTypes?: Map<string, GraphNode["type"]>;
}

function collectNeighborhood(
  startId: string,
  edges: GraphEdge[],
  maxDepth: number,
  options?: NeighborhoodOptions,
): Set<string> {
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];

  for (let depth = 0; depth < maxDepth; depth++) {
    if (frontier.length === 0) break;
    const next: string[] = [];

    for (const nodeId of frontier) {
      const nodeType = options?.nodeTypes?.get(nodeId);
      if (options?.stopAtTeamHubs && nodeType === "team" && nodeId !== startId) {
        continue;
      }

      for (const edge of edges) {
        if (edge.source === nodeId && !visited.has(edge.target)) {
          visited.add(edge.target);
          next.push(edge.target);
        }
        if (edge.target === nodeId && !visited.has(edge.source)) {
          visited.add(edge.source);
          next.push(edge.source);
        }
      }
    }

    frontier = next;
  }

  return visited;
}

function withHexAlpha(color: string, alphaHex: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alphaHex}`;
  }
  return color;
}

function resolveCommitTeamId(commit: TreeCommit, includeUnscoped: boolean): string | null {
  if (commit.team_id) return commit.team_id;
  return includeUnscoped ? "unscoped" : null;
}

function resolveLeakTeamId(leak: TreeLeak, includeUnscoped: boolean): string | null {
  if (leak.team_id) return leak.team_id;
  return includeUnscoped ? "unscoped" : null;
}

function unwrapNodeEntityId(nodeId: string): string {
  const separatorIndex = nodeId.indexOf(":");
  if (separatorIndex === -1) return nodeId;
  return nodeId.slice(separatorIndex + 1);
}

interface EntityVisibilityOptions {
  jira: boolean;
  slack: boolean;
  github: boolean;
}

function initializeLayout(
  commits: TreeCommit[],
  teams: TreeTeam[],
  leaks: TreeLeak[],
  entities: LedgerEntity[],
  inferredLinks: InferredLink[],
  entityVisibility: EntityVisibilityOptions,
  width: number,
  height: number,
  density: number,
): { nodes: GraphNode[]; edges: GraphEdge[]; teamBands: TeamBand[]; entityStats: { totalEligible: number; rendered: number } } {
  const nodes: GraphNode[] = [];
  const rawEdges: RawGraphEdge[] = [];

  const hasUnscopedNodes = commits.some((commit) => !commit.team_id) || leaks.some((leak) => !leak.team_id);
  const graphTeams = hasUnscopedNodes
    ? [...teams, { id: "unscoped", name: "Unscoped", slug: "unscoped", color: "#9ca3af", icon: null }]
    : teams;

  const marginX = Math.max(36, width * 0.03);
  const zoneCount = Math.max(1, graphTeams.length);
  const zoneWidth = (width - marginX * 2) / zoneCount;
  const densityNorm = clamp((density - 25) / 75, 0, 1);

  const teamXCenter = new Map<string, number>();
  const teamBands: TeamBand[] = [];

  for (const [index, team] of graphTeams.entries()) {
    const startX = marginX + index * zoneWidth;
    const endX = startX + zoneWidth;
    const centerX = startX + zoneWidth / 2;

    teamXCenter.set(team.id, centerX);
    teamBands.push({
      teamId: team.id,
      label: team.name,
      color: team.color || "#6b7280",
      startX,
      endX,
    });

    nodes.push({
      id: `team:${team.id}`,
      type: "team",
      label: team.name,
      color: team.color || "#6b7280",
      x: centerX,
      y: seededBetween(`team:y:${team.id}`, height * (TEAM_LAYER_RATIO - 0.05), height * (TEAM_LAYER_RATIO + 0.05)),
      vx: 0,
      vy: 0,
      radius: 14,
      teamId: team.id,
      homeX: centerX,
      homeY: height * TEAM_LAYER_RATIO,
    });
  }

  const teamNodeIds = new Set(graphTeams.map((team) => `team:${team.id}`));
  const commitById = new Map(commits.map((commit) => [commit.id, commit]));
  const leakById = new Map(leaks.map((leak) => [leak.id, leak]));

  const commitTeamById = new Map<string, string | null>();
  for (const commit of commits) {
    commitTeamById.set(commit.id, resolveCommitTeamId(commit, hasUnscopedNodes));
  }

  const leakTeamById = new Map<string, string | null>();
  for (const leak of leaks) {
    leakTeamById.set(leak.id, resolveLeakTeamId(leak, hasUnscopedNodes));
  }

  for (const commit of commits) {
    const colorByType: Record<string, string> = {
      decision: "#06b6d4",
      action: "#22c55e",
      policy: "#a855f7",
      template_change: "#f59e0b",
      rollback: "#ef4444",
      override: "#f59e0b",
    };

    const teamId = commitTeamById.get(commit.id) || null;
    const centerX = teamId ? teamXCenter.get(teamId) ?? width / 2 : width / 2;

    const spread = zoneWidth * (0.46 + densityNorm * 0.44);
    const ySpread = height * (0.16 + densityNorm * 0.12);
    const homeX = clamp(
      seededBetween(`commit:x:${commit.id}`, centerX - spread, centerX + spread),
      20,
      width - 20,
    );
    const homeY = seededBetween(
      `commit:y:${commit.id}`,
      height * COMMIT_LAYER_RATIO - ySpread,
      height * COMMIT_LAYER_RATIO + ySpread,
    );

    nodes.push({
      id: `commit:${commit.id}`,
      type: "commit",
      label: commit.title.length > 24 ? `${commit.title.slice(0, 24)}...` : commit.title,
      color: colorByType[commit.commit_type] || "#6b7280",
      x: homeX,
      y: homeY,
      vx: 0,
      vy: 0,
      radius: 8,
      teamId,
      homeX,
      homeY,
    });

    if (teamId && teamNodeIds.has(`team:${teamId}`)) {
      rawEdges.push({
        source: `commit:${commit.id}`,
        target: `team:${teamId}`,
        type: "belongs_to",
        sourceTeam: teamId,
        targetTeam: teamId,
      });
    }

    for (const edge of commit.edges || []) {
      if (edge.edge_type === "triggered_by" && edge.target_type === "leak_instance") {
        const targetLeak = leakById.get(edge.target_id);
        if (!targetLeak) continue;
        rawEdges.push({
          source: `commit:${commit.id}`,
          target: `leak:${edge.target_id}`,
          type: "triggered_by",
          sourceTeam: teamId,
          targetTeam: leakTeamById.get(edge.target_id) || null,
        });
      }

      if (edge.edge_type === "depends_on" && edge.target_type === "ledger_commit") {
        const targetCommit = commitById.get(edge.target_id);
        if (!targetCommit) continue;
        rawEdges.push({
          source: `commit:${commit.id}`,
          target: `commit:${edge.target_id}`,
          type: "depends_on",
          sourceTeam: teamId,
          targetTeam: commitTeamById.get(edge.target_id) || null,
        });
      }
    }
  }

  for (const leak of leaks) {
    const severityColor = leak.severity >= 70 ? "#ef4444" : leak.severity >= 40 ? "#f59e0b" : "#eab308";
    const teamId = leakTeamById.get(leak.id) || null;
    const centerX = teamId ? teamXCenter.get(teamId) ?? width / 2 : width / 2;

    const spread = zoneWidth * (0.42 + densityNorm * 0.38);
    const ySpread = height * (0.12 + densityNorm * 0.09);
    const homeX = clamp(
      seededBetween(`leak:x:${leak.id}`, centerX - spread, centerX + spread),
      20,
      width - 20,
    );
    const homeY = seededBetween(
      `leak:y:${leak.id}`,
      height * LEAK_LAYER_RATIO - ySpread,
      height * LEAK_LAYER_RATIO + ySpread,
    );

    nodes.push({
      id: `leak:${leak.id}`,
      type: "leak",
      label: leak.rule_key,
      color: severityColor,
      x: homeX,
      y: homeY,
      vx: 0,
      vy: 0,
      radius: 7,
      teamId,
      homeX,
      homeY,
    });

    if (teamId && teamNodeIds.has(`team:${teamId}`)) {
      rawEdges.push({
        source: `leak:${leak.id}`,
        target: `team:${teamId}`,
        type: "owned_by",
        sourceTeam: teamId,
        targetTeam: teamId,
      });
    }
  }

  const eligibleEntities = entities
    .filter((entity) => entityVisibility[entity.provider])
    .filter((entity) => entity.commit_ids.some((commitId) => commitById.has(commitId)))
    .sort((a, b) => {
      const countDelta = b.commit_ids.length - a.commit_ids.length;
      if (countDelta !== 0) return countDelta;
      return `${a.provider}:${a.entity_id}`.localeCompare(`${b.provider}:${b.entity_id}`);
    });

  const visibleEntities = eligibleEntities.slice(0, MAX_VISIBLE_ENTITY_NODES);
  const entityNodeIdsByExactKey = new Map<string, string>();
  const entityNodeIdsByLooseKey = new Map<string, string>();

  for (const entity of visibleEntities) {
    const teamId = entity.team_ids.find((candidate) => teamXCenter.has(candidate))
      ?? (hasUnscopedNodes ? "unscoped" : null);
    const centerX = teamId ? teamXCenter.get(teamId) ?? width / 2 : width / 2;
    const spread = zoneWidth * (0.4 + densityNorm * 0.36);
    const ySpread = height * (0.13 + densityNorm * 0.08);
    const entityKey = `${entity.provider}:${entity.entity_type ?? "unknown"}:${entity.entity_id}`;

    const homeX = clamp(
      seededBetween(`entity:x:${entityKey}`, centerX - spread, centerX + spread),
      20,
      width - 20,
    );
    const homeY = seededBetween(
      `entity:y:${entityKey}`,
      height * ENTITY_LAYER_RATIO - ySpread,
      height * ENTITY_LAYER_RATIO + ySpread,
    );

    const nodeId = `entity:${entityKey}`;
    const providerColor = entity.provider === "jira"
      ? "#2684ff"
      : entity.provider === "slack"
        ? "#e879f9"
        : "#238636";

    const labelBase = entity.title || entity.entity_id;
    nodes.push({
      id: nodeId,
      type: entity.provider,
      label: labelBase.length > 26 ? `${labelBase.slice(0, 26)}...` : labelBase,
      color: providerColor,
      x: homeX,
      y: homeY,
      vx: 0,
      vy: 0,
      radius: 8,
      teamId,
      homeX,
      homeY,
      entity,
    });

    entityNodeIdsByExactKey.set(`${entity.provider}:${(entity.entity_type || "").trim().toLowerCase()}:${entity.entity_id}`, nodeId);
    entityNodeIdsByLooseKey.set(`${entity.provider}:${entity.entity_id}`, nodeId);

    for (const commitId of entity.commit_ids) {
      if (!commitById.has(commitId)) continue;

      rawEdges.push({
        source: `commit:${commitId}`,
        target: nodeId,
        type: "linked_entity",
        sourceTeam: commitTeamById.get(commitId) || null,
        targetTeam: teamId,
      });
    }
  }

  const teamByNodeId = new Map<string, string | null>();
  for (const node of nodes) {
    teamByNodeId.set(node.id, node.teamId);
  }

  for (const inferredLink of inferredLinks) {
    if (inferredLink.status === "dismissed" || inferredLink.status === "expired") continue;
    if (inferredLink.confidence_tier === "weak") continue;

    const sourceExactKey = `${inferredLink.source_provider}:${(inferredLink.source_entity_type || "").trim().toLowerCase()}:${inferredLink.source_entity_id}`;
    const targetExactKey = `${inferredLink.target_provider}:${(inferredLink.target_entity_type || "").trim().toLowerCase()}:${inferredLink.target_entity_id}`;
    const sourceLooseKey = `${inferredLink.source_provider}:${inferredLink.source_entity_id}`;
    const targetLooseKey = `${inferredLink.target_provider}:${inferredLink.target_entity_id}`;

    const sourceNodeId = entityNodeIdsByExactKey.get(sourceExactKey) || entityNodeIdsByLooseKey.get(sourceLooseKey);
    const targetNodeId = entityNodeIdsByExactKey.get(targetExactKey) || entityNodeIdsByLooseKey.get(targetLooseKey);

    if (!sourceNodeId || !targetNodeId) continue;
    if (sourceNodeId === targetNodeId) continue;

    rawEdges.push({
      source: sourceNodeId,
      target: targetNodeId,
      type: "inferred_link",
      sourceTeam: teamByNodeId.get(sourceNodeId) || inferredLink.team_id,
      targetTeam: teamByNodeId.get(targetNodeId) || inferredLink.team_id,
      inferredLinkId: inferredLink.id,
      inferredConfidence: inferredLink.confidence,
      inferredTier: inferredLink.confidence_tier,
      inferredReason: inferredLink.inference_reason,
      inferredStatus: inferredLink.status,
    });
  }

  const degreeByNode = new Map<string, number>();
  for (const edge of rawEdges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) || 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) || 0) + 1);
  }

  for (const node of nodes) {
    const degree = degreeByNode.get(node.id) || 0;
    const maxRadius = node.type === "team" ? 22 : node.type === "commit" ? 13 : 11;
    node.radius = Math.min(maxRadius, node.radius + degree * 0.45);
  }

  const totalByPair = new Map<string, number>();
  for (const edge of rawEdges) {
    const pair = [edge.source, edge.target].sort().join("|");
    const pairKey = `${pair}|${edge.type}`;
    totalByPair.set(pairKey, (totalByPair.get(pairKey) || 0) + 1);
  }

  const seenByPair = new Map<string, number>();
  const edges: GraphEdge[] = rawEdges.map((edge) => {
    const pair = [edge.source, edge.target].sort().join("|");
    const pairKey = `${pair}|${edge.type}`;
    const total = totalByPair.get(pairKey) || 1;
    const seen = seenByPair.get(pairKey) || 0;
    seenByPair.set(pairKey, seen + 1);

    return {
      id: `${edge.source}|${edge.target}|${edge.type}|${seen}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      curveOffset: seen - (total - 1) / 2,
      isCrossTeam: Boolean(
        edge.sourceTeam &&
          edge.targetTeam &&
          edge.sourceTeam !== edge.targetTeam &&
          edge.type !== "belongs_to" &&
          edge.type !== "owned_by" &&
          edge.type !== "inferred_link",
      ),
      inferredLinkId: edge.inferredLinkId,
      inferredConfidence: edge.inferredConfidence,
      inferredTier: edge.inferredTier,
      inferredReason: edge.inferredReason,
      inferredStatus: edge.inferredStatus,
    };
  });

  return {
    nodes,
    edges,
    teamBands,
    entityStats: {
      totalEligible: eligibleEntities.length,
      rendered: visibleEntities.length,
    },
  };
}

function runSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  density: number,
): void {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const densityNorm = clamp((density - 25) / 75, 0, 1);
  const spreadMultiplier = 0.8 + densityNorm * 0.8;
  const repulsion = REPULSION * (0.72 + densityNorm * 0.98);
  const edgeTensionScale = 1.15 - densityNorm * 0.5;
  const homePullScale = 1.08 - densityNorm * 0.3;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy + 0.1;
        const dist = Math.sqrt(distSq);
        const minDist = a.radius + b.radius + COLLISION_PADDING;

        let force = repulsion / distSq;
        if (dist < minDist) {
          force += (minDist - dist) * 0.45;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const fx = nx * force;
        const fy = ny * force;

        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));

      let preferredDistance = width * 0.18;
      if (edge.type === "belongs_to" || edge.type === "owned_by") {
        preferredDistance = width * 0.22;
      }
      if (edge.type === "triggered_by") {
        preferredDistance = edge.isCrossTeam ? width * 0.34 : width * 0.2;
      }
      if (edge.type === "depends_on") {
        preferredDistance = edge.isCrossTeam ? width * 0.38 : width * 0.22;
      }
      preferredDistance *= spreadMultiplier;

      const edgeTensionBase = edge.isCrossTeam ? EDGE_PULL * 0.45 : EDGE_PULL;
      const edgeTension = edgeTensionBase * edgeTensionScale;
      const delta = dist - preferredDistance;
      const force = edgeTension * delta;
      const nx = dx / dist;
      const ny = dy / dist;

      source.vx += nx * force;
      source.vy += ny * force;
      target.vx -= nx * force;
      target.vy -= ny * force;
    }

    for (const node of nodes) {
      const pullX = (node.type === "team" ? TEAM_ANCHOR_PULL_X : HOME_PULL_X) * homePullScale;
      const pullY = (node.type === "team" ? TEAM_ANCHOR_PULL_Y : HOME_PULL_Y) * homePullScale;

      // Team anchors should stay centered in their lane by default.
      if (node.type === "team") {
        node.vx = 0;
        node.vy = 0;
        node.x = node.homeX;
        node.y = node.homeY;
        continue;
      }

      node.vx += (node.homeX - node.x) * pullX;
      node.vy += (node.homeY - node.y) * pullY;

      const margin = node.radius + 16;
      if (node.x < margin) node.vx += (margin - node.x) * 0.18;
      if (node.x > width - margin) node.vx -= (node.x - (width - margin)) * 0.18;
      if (node.y < margin) node.vy += (margin - node.y) * 0.18;
      if (node.y > height - margin) node.vy -= (node.y - (height - margin)) * 0.18;

      node.vx *= DAMPING;
      node.vy *= DAMPING;

      node.vx = clamp(node.vx, -8, 8);
      node.vy = clamp(node.vy, -8, 8);

      node.x += node.vx;
      node.y += node.vy;

      node.x = clamp(node.x, node.radius + 8, width - node.radius - 8);
      node.y = clamp(node.y, node.radius + 8, height - node.radius - 8);
    }
  }
}

function edgePath(a: GraphNode, b: GraphNode, curveOffset: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / dist;
  const ny = dx / dist;
  const bend = curveOffset * 16;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function regularPolygonPoints(cx: number, cy: number, radius: number, sides: number, rotation = 0): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (Math.PI * 2 * i) / sides;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

function describeInferenceReason(reason: unknown): string {
  if (Array.isArray(reason)) {
    const labels = reason
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const signal = (item as { signal?: unknown }).signal;
        const score = (item as { score?: unknown }).score;
        if (typeof signal !== "string") return null;
        if (typeof score === "number") {
          return `${signal} (${Math.round(score * 100)}%)`;
        }
        return signal;
      })
      .filter((value): value is string => Boolean(value));

    return labels.length > 0 ? labels.join(" • ") : "No inference metadata";
  }

  if (reason && typeof reason === "object") {
    try {
      return JSON.stringify(reason);
    } catch {
      return "No inference metadata";
    }
  }

  return "No inference metadata";
}

function mapSavedRouteRow(row: SavedRouteApiRow): SavedRouteEntry {
  return {
    id: row.id,
    name: row.name,
    solutionDraft: row.solution_draft || "",
    createdAt: row.created_at,
    snapshot: row.snapshot,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function toDateOnlyValue(value: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function isDateWithinRange(value: string, from: string, to: string): boolean {
  const date = toDateOnlyValue(value);
  if (!date) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function hasAnyGraphFilter(filterState: GraphFilterState): boolean {
  return Boolean(
    filterState.typeFilter !== "all"
      || filterState.statusFilter !== "all"
      || filterState.branchFilter
      || filterState.jiraKeyFilter
      || filterState.prFilter
      || filterState.slackChannelFilter
      || filterState.tagFilters.length > 0
      || filterState.dateFrom
      || filterState.dateTo,
  );
}

export function ForceDirectedGraph({
  commits,
  teams,
  leaks,
  entities = [],
  inferredLinks = [],
  teamId = null,
  projectId = null,
  filterState,
}: ForceDirectedGraphProps) {
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphViewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const initialNodesRef = useRef<GraphNode[]>([]);
  const dragMovedRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const canvasPanStateRef = useRef<CanvasPanState | null>(null);
  const nodePointerDownScrollYRef = useRef<number | null>(null);
  const windowScrollHistoryRef = useRef({ previous: 0, current: 0, updatedAt: 0 });
  const hasAppliedOverviewRef = useRef(false);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lockedFocusIds, setLockedFocusIds] = useState<string[]>([]);
  const [lastLockedId, setLastLockedId] = useState<string | null>(null);
  const [multiFocusEnabled, setMultiFocusEnabled] = useState(false);
  const [showJiraEntities, setShowJiraEntities] = useState(false);
  const [showSlackEntities, setShowSlackEntities] = useState(false);
  const [showGithubEntities, setShowGithubEntities] = useState(false);
  const [navigationLockEnabled, setNavigationLockEnabled] = useState(true);
  const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const [density, setDensity] = useState(55);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredInferredEdgeId, setHoveredInferredEdgeId] = useState<string | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteEntry[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [routeNameDraft, setRouteNameDraft] = useState<string>("");
  const [routeSolutionDraft, setRouteSolutionDraft] = useState<string>("");
  const [dispatchProvider, setDispatchProvider] = useState<"slack" | "jira" | "github">("slack");
  const [dispatchTarget, setDispatchTarget] = useState<string>("");
  const [routeStatusMessage, setRouteStatusMessage] = useState<string>("");
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const traversalHistoryRef = useRef<TraversalStateSnapshot[]>([]);
  const lastHistorySignatureRef = useRef<string>("");
  const applyingSnapshotRef = useRef(false);
  const autosaveHydratedRef = useRef(false);

  const updateInferredStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "confirmed" | "dismissed" }) =>
      apiFetch(`/api/inferred-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actor: "graph_ui" }),
      }),
    onSuccess: () => {
      setHoveredInferredEdgeId(null);
      queryClient.invalidateQueries({ queryKey: ["ledger-tree"] });
    },
  });

  const routeScopeQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (teamId) params.set("team_id", teamId);
    if (projectId) params.set("project_id", projectId);
    return params.toString();
  }, [teamId, projectId]);

  const routesQueryKey = useMemo(
    () => ["ledger-routes", teamId, projectId] as const,
    [teamId, projectId],
  );

  const persistedRoutesQuery = useQuery<{ routes: SavedRouteApiRow[] }>({
    queryKey: routesQueryKey,
    queryFn: () => apiFetch(`/api/ledger/routes${routeScopeQuery ? `?${routeScopeQuery}` : ""}`),
    staleTime: 10000,
  });

  const createRouteMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      solution_draft: string;
      snapshot: RouteSnapshotV1;
      dataset_signature: string;
      team_id: string | null;
      project_id: string | null;
      created_by: string;
    }) =>
      apiFetch<{ route: SavedRouteApiRow }>("/api/ledger/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });

  const deleteRouteMutation = useMutation({
    mutationFn: (routeId: string) =>
      apiFetch<{ deleted: boolean; id: string }>(`/api/ledger/routes/${routeId}`, {
        method: "DELETE",
      }),
  });

  const updateRouteMutation = useMutation({
    mutationFn: (payload: {
      routeId: string;
      name?: string;
      solution_draft?: string | null;
      snapshot?: RouteSnapshotV1;
      dataset_signature?: string;
    }) =>
      apiFetch<{ route: SavedRouteApiRow }>(`/api/ledger/routes/${payload.routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.solution_draft !== undefined ? { solution_draft: payload.solution_draft } : {}),
          ...(payload.snapshot ? { snapshot: payload.snapshot } : {}),
          ...(payload.dataset_signature ? { dataset_signature: payload.dataset_signature } : {}),
        }),
      }),
  });

  const dispatchRouteMutation = useMutation({
    mutationFn: (payload: {
      routeId: string;
      provider: "slack" | "jira" | "github";
      target: string;
      actor: string;
    }) =>
      apiFetch<{ dispatch: { id: string } }>(`/api/ledger/routes/${payload.routeId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: payload.provider,
          target: payload.target,
          actor: payload.actor,
        }),
      }),
  });

  const teamCountForSizing = useMemo(() => {
    const hasUnscopedNodes = commits.some((commit) => !commit.team_id) || leaks.some((leak) => !leak.team_id);
    return Math.max(1, teams.length + (hasUnscopedNodes ? 1 : 0));
  }, [commits, leaks, teams]);

  const visibleEntityCountForSizing = useMemo(() => {
    const commitIds = new Set(commits.map((commit) => commit.id));
    const count = entities
      .filter((entity) => {
        if (entity.provider === "jira" && !showJiraEntities) return false;
        if (entity.provider === "slack" && !showSlackEntities) return false;
        if (entity.provider === "github" && !showGithubEntities) return false;
        return entity.commit_ids.some((commitId) => commitIds.has(commitId));
      })
      .length;

    return Math.min(MAX_VISIBLE_ENTITY_NODES, count);
  }, [commits, entities, showGithubEntities, showJiraEntities, showSlackEntities]);

  const totalNodeCountForSizing = commits.length + leaks.length + teamCountForSizing + visibleEntityCountForSizing;

  useEffect(() => {
    const element = graphViewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      const sandboxWidth = Math.floor(rect.width * SANDBOX_SCALE);
      const teamDrivenWidth = Math.ceil(teamCountForSizing * TEAM_LANE_TARGET_WIDTH);
      const densityPerLane = totalNodeCountForSizing / teamCountForSizing;
      const nodeDrivenWidth = Math.ceil(teamDrivenWidth + densityPerLane * NODE_WIDTH_PRESSURE);
      const nextWidth = Math.max(MIN_GRAPH_WIDTH, sandboxWidth, teamDrivenWidth, nodeDrivenWidth);

      const widthRatioHeight = Math.floor(nextWidth * 0.74);
      const nodeDrivenHeight = Math.ceil(
        MIN_GRAPH_HEIGHT
          + densityPerLane * NODE_HEIGHT_PRESSURE
          + Math.sqrt(Math.max(totalNodeCountForSizing, 1)) * 20,
      );
      const nextHeight = Math.max(
        MIN_GRAPH_HEIGHT,
        Math.min(MAX_GRAPH_HEIGHT, Math.max(widthRatioHeight, nodeDrivenHeight)),
      );

      setSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [isFullscreen, teamCountForSizing, totalNodeCountForSizing]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const syncScrollHistory = () => {
      const next = window.scrollY;
      const current = windowScrollHistoryRef.current.current;
      windowScrollHistoryRef.current = {
        previous: current,
        current: next,
        updatedAt: Date.now(),
      };
    };

    syncScrollHistory();
    window.addEventListener("scroll", syncScrollHistory, { passive: true });
    return () => window.removeEventListener("scroll", syncScrollHistory);
  }, []);

  const initialLayout = useMemo(() => {
    const layout = initializeLayout(
      commits,
      teams,
      leaks,
      entities,
      inferredLinks,
      {
        jira: showJiraEntities,
        slack: showSlackEntities,
        github: showGithubEntities,
      },
      size.width,
      size.height,
      density,
    );
    runSimulation(layout.nodes, layout.edges, size.width, size.height, density);
    return layout;
  }, [commits, teams, leaks, entities, inferredLinks, showJiraEntities, showSlackEntities, showGithubEntities, size.width, size.height, density]);

  const graphFitTransform = useMemo(
    () => computeGraphFitTransform(initialLayout.nodes, size.width, size.height),
    [initialLayout.nodes, size.height, size.width],
  );

  const centerGraphViewport = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;

    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
  }, []);

  const computeOverviewZoom = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return DEFAULT_ZOOM;

    const fitByWidth = viewport.clientWidth / Math.max(size.width, 1);
    const fitByHeight = viewport.clientHeight / Math.max(size.height, 1);
    const fitZoom = Math.min(fitByWidth, fitByHeight);
    return clamp(fitZoom, ZOOM_MIN, ZOOM_MAX);
  }, [size.height, size.width]);

  const datasetSignature = useMemo(() => {
    const commitSig = commits.map((commit) => commit.id).sort().join(",");
    const leakSig = leaks.map((leak) => leak.id).sort().join(",");
    const teamSig = teams.map((team) => team.id).sort().join(",");
    return `c:${commitSig}|l:${leakSig}|t:${teamSig}`;
  }, [commits, leaks, teams]);

  const captureTraversalState = useCallback((): TraversalStateSnapshot => {
    return {
      lockedFocusIds,
      lastLockedId,
      multiFocusEnabled,
      focusDepth,
      showJiraEntities,
      showSlackEntities,
      showGithubEntities,
      navigationLockEnabled,
      zoom,
      zoomOffsetX: zoomOffset.x,
      zoomOffsetY: zoomOffset.y,
      density,
    };
  }, [
    lockedFocusIds,
    lastLockedId,
    multiFocusEnabled,
    focusDepth,
    showJiraEntities,
    showSlackEntities,
    showGithubEntities,
    navigationLockEnabled,
    zoom,
    zoomOffset,
    density,
  ]);

  const applyTraversalState = useCallback((snapshot: TraversalStateSnapshot) => {
    applyingSnapshotRef.current = true;
    lastHistorySignatureRef.current = JSON.stringify(snapshot);
    setLockedFocusIds(snapshot.lockedFocusIds || []);
    setLastLockedId(snapshot.lastLockedId || null);
    setMultiFocusEnabled(Boolean(snapshot.multiFocusEnabled));
    setFocusDepth(snapshot.focusDepth === 2 ? 2 : 1);
    setShowJiraEntities(Boolean(snapshot.showJiraEntities));
    setShowSlackEntities(Boolean(snapshot.showSlackEntities));
    setShowGithubEntities(Boolean(snapshot.showGithubEntities));
    setNavigationLockEnabled(Boolean(snapshot.navigationLockEnabled));
    const restoredZoom = Number(snapshot.zoom);
    const normalizedRestoredZoom = Number.isFinite(restoredZoom) && restoredZoom > 0
      ? restoredZoom
      : DEFAULT_ZOOM;
    setZoom(clamp(normalizedRestoredZoom, ZOOM_MIN, ZOOM_MAX));
    const restoredOffsetX = Number(snapshot.zoomOffsetX);
    const restoredOffsetY = Number(snapshot.zoomOffsetY);
    setZoomOffset({
      x: Number.isFinite(restoredOffsetX) ? restoredOffsetX : 0,
      y: Number.isFinite(restoredOffsetY) ? restoredOffsetY : 0,
    });
    setDensity(clamp(Number(snapshot.density) || 55, 25, 100));
    window.setTimeout(() => {
      applyingSnapshotRef.current = false;
    }, 0);
  }, []);

  const buildRouteSnapshot = useCallback((): RouteSnapshotV1 => {
    const nodePositions: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) {
      nodePositions[node.id] = { x: node.x, y: node.y };
    }
    return {
      version: 1,
      datasetSignature,
      traversal: captureTraversalState(),
      nodePositions,
      capturedAt: new Date().toISOString(),
    };
  }, [nodes, datasetSignature, captureTraversalState]);

  const applyRouteSnapshot = useCallback((snapshot: RouteSnapshotV1) => {
    applyTraversalState(snapshot.traversal);
    const positions = snapshot.nodePositions || {};
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const position = positions[node.id];
        if (!position) return node;
        return {
          ...node,
          x: clamp(position.x, node.radius + 8, size.width - node.radius - 8),
          y: clamp(position.y, node.radius + 8, size.height - node.radius - 8),
          vx: 0,
          vy: 0,
        };
      }),
    );
  }, [applyTraversalState, size.width, size.height]);

  const traversalSignature = useMemo(() => JSON.stringify(captureTraversalState()), [captureTraversalState]);

  useEffect(() => {
    if (traversalHistoryRef.current.length === 0) {
      const initialSnapshot = captureTraversalState();
      traversalHistoryRef.current = [initialSnapshot];
      setHistoryIndex(0);
      lastHistorySignatureRef.current = JSON.stringify(initialSnapshot);
      return;
    }

    if (applyingSnapshotRef.current) return;
    if (lastHistorySignatureRef.current === traversalSignature) return;

    const currentSnapshot = captureTraversalState();
    const trimmed = traversalHistoryRef.current.slice(0, historyIndex + 1);
    trimmed.push(currentSnapshot);
    if (trimmed.length > 80) {
      trimmed.shift();
    }

    traversalHistoryRef.current = trimmed;
    const nextIndex = trimmed.length - 1;
    setHistoryIndex(nextIndex);
    lastHistorySignatureRef.current = JSON.stringify(currentSnapshot);
  }, [captureTraversalState, historyIndex, traversalSignature]);

  useEffect(() => {
    if (!persistedRoutesQuery.data?.routes) return;
    const mapped = persistedRoutesQuery.data.routes.map(mapSavedRouteRow);
    setSavedRoutes(mapped.slice(0, MAX_SAVED_ROUTES));
  }, [persistedRoutesQuery.data?.routes]);

  useEffect(() => {
    if (!persistedRoutesQuery.error) return;
    setRouteStatusMessage(getErrorMessage(persistedRoutesQuery.error, "Failed to load saved routes"));
  }, [persistedRoutesQuery.error]);

  useEffect(() => {
    if (!selectedRouteId) return;
    if (savedRoutes.some((route) => route.id === selectedRouteId)) return;
    setSelectedRouteId(savedRoutes[0]?.id || "");
  }, [savedRoutes, selectedRouteId]);

  useEffect(() => {
    if (!selectedRouteId) return;
    const route = savedRoutes.find((entry) => entry.id === selectedRouteId);
    if (!route) return;
    setRouteNameDraft(route.name);
    setRouteSolutionDraft(route.solutionDraft);
  }, [savedRoutes, selectedRouteId]);

  useEffect(() => {
    hasAppliedOverviewRef.current = false;
  }, [datasetSignature]);

  useEffect(() => {
    if (hasAppliedOverviewRef.current) return;
    if (nodes.length === 0) return;

    hasAppliedOverviewRef.current = true;
    setZoom(computeOverviewZoom());
    setZoomOffset({ x: 0, y: 0 });
    window.requestAnimationFrame(() => {
      centerGraphViewport();
    });
  }, [nodes.length, computeOverviewZoom, centerGraphViewport]);

  useEffect(() => {
    if (autosaveHydratedRef.current) return;
    if (nodes.length === 0) return;

    autosaveHydratedRef.current = true;
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(GRAPH_AUTOSAVE_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as RouteSnapshotV1;
      if (!snapshot || snapshot.version !== 1) return;
      if (snapshot.datasetSignature !== datasetSignature) return;
      applyRouteSnapshot(snapshot);
      // Keep first-load experience at widest context even after restoring traversal data.
      setZoom(computeOverviewZoom());
      setZoomOffset({ x: 0, y: 0 });
      window.requestAnimationFrame(() => {
        centerGraphViewport();
      });
      setRouteStatusMessage("Restored previous traversal");
    } catch {
      // Ignore parse/storage errors.
    }
  }, [nodes.length, datasetSignature, applyRouteSnapshot, computeOverviewZoom, centerGraphViewport]);

  useEffect(() => {
    if (!autosaveHydratedRef.current) return;
    if (typeof window === "undefined") return;

    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(GRAPH_AUTOSAVE_KEY, JSON.stringify(buildRouteSnapshot()));
      } catch {
        // Ignore storage errors.
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [buildRouteSnapshot, traversalSignature, nodes]);

  useEffect(() => {
    if (!routeStatusMessage) return;
    const timeout = window.setTimeout(() => setRouteStatusMessage(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [routeStatusMessage]);

  useEffect(() => {
    const freshNodes = cloneNodes(initialLayout.nodes);
    setNodes(freshNodes);
    initialNodesRef.current = cloneNodes(freshNodes);
    setHoveredId(null);
    setLockedFocusIds([]);
    setLastLockedId(null);
    dragStateRef.current = null;
    dragMovedRef.current = false;
    setDragState(null);
    setHoveredInferredEdgeId(null);
  }, [initialLayout]);

  useEffect(() => {
    setLastLockedId((current) => {
      if (lockedFocusIds.length === 0) return null;
      if (current && lockedFocusIds.includes(current)) return current;
      return lockedFocusIds[lockedFocusIds.length - 1] ?? null;
    });
  }, [lockedFocusIds]);

  const nodeTypeById = useMemo(() => {
    return new Map(initialLayout.nodes.map((node) => [node.id, node.type]));
  }, [initialLayout.nodes]);

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const commitsById = useMemo(() => new Map(commits.map((commit) => [commit.id, commit])), [commits]);
  const leaksById = useMemo(() => new Map(leaks.map((leak) => [leak.id, leak])), [leaks]);
  const teamsById = useMemo(() => {
    const entries = teams.map((team) => [team.id, team] as const);
    entries.push([
      "unscoped",
      { id: "unscoped", name: "Unscoped", slug: "unscoped", color: "#9ca3af", icon: null } as TreeTeam,
    ]);
    return new Map(entries);
  }, [teams]);

  const activeFilterState = useMemo<GraphFilterState>(() => {
    return {
      typeFilter: filterState?.typeFilter || "all",
      statusFilter: filterState?.statusFilter || "all",
      branchFilter: filterState?.branchFilter || "",
      jiraKeyFilter: filterState?.jiraKeyFilter || "",
      prFilter: filterState?.prFilter || "",
      slackChannelFilter: filterState?.slackChannelFilter || "",
      tagFilters: filterState?.tagFilters || [],
      dateFrom: filterState?.dateFrom || "",
      dateTo: filterState?.dateTo || "",
    };
  }, [filterState]);

  const hasGraphFilters = useMemo(() => hasAnyGraphFilter(activeFilterState), [activeFilterState]);

  const lockedFocusSet = useMemo(() => new Set(lockedFocusIds), [lockedFocusIds]);
  const hasLockedFocus = lockedFocusIds.length > 0;
  const depthCapped = hasLockedFocus && lockedFocusIds.length > MAX_LOCKS_FOR_FULL_DEPTH && focusDepth > 1;
  const activeDepth: number = hasLockedFocus
    ? (lockedFocusIds.length > MAX_LOCKS_FOR_FULL_DEPTH ? 1 : focusDepth)
    : 1;
  const activeFocusIds = useMemo(() => {
    if (hasLockedFocus) return lockedFocusIds;
    if (!hasGraphFilters && hoveredId) return [hoveredId];
    return [];
  }, [hasGraphFilters, hasLockedFocus, hoveredId, lockedFocusIds]);
  const hasActiveFocus = activeFocusIds.length > 0;

  const connectedIds = useMemo(() => {
    if (!hasActiveFocus) return new Set<string>();

    // Hover shows immediate context; locked focus can expand to a broader neighborhood.
    const depth = activeDepth;
    const merged = new Set<string>();

    for (const focusId of activeFocusIds) {
      const focusType = nodeTypeById.get(focusId);
      let effectiveDepth: number = depth;

      if (hasLockedFocus && multiFocusEnabled && lastLockedId && focusId !== lastLockedId) {
        // In multi-focus mode, only the most recently locked node gets depth expansion.
        effectiveDepth = 0;
      }

      if (hasLockedFocus && multiFocusEnabled && focusType === "team" && lastLockedId && focusId !== lastLockedId) {
        // Team hubs should not fan out when they are not the current focus anchor.
        effectiveDepth = 0;
      }

      // Prevent 2-hop from exploding via team hubs unless the team node itself is the focus.
      const stopAtTeamHubs = effectiveDepth > 1 && focusType !== "team";
      const neighborhood = collectNeighborhood(focusId, initialLayout.edges, effectiveDepth, {
        stopAtTeamHubs,
        nodeTypes: nodeTypeById,
      });
      for (const nodeId of neighborhood) {
        merged.add(nodeId);
      }
    }

    return merged;
  }, [activeDepth, activeFocusIds, hasActiveFocus, hasLockedFocus, initialLayout.edges, lastLockedId, multiFocusEnabled, nodeTypeById]);

  const directNeighborIds = useMemo(() => {
    if (!hasActiveFocus) return new Set<string>();

    const merged = new Set<string>();
    for (const focusId of activeFocusIds) {
      const neighborhood = collectNeighborhood(focusId, initialLayout.edges, 1, {
        nodeTypes: nodeTypeById,
      });
      for (const nodeId of neighborhood) {
        merged.add(nodeId);
      }
    }
    return merged;
  }, [activeFocusIds, hasActiveFocus, initialLayout.edges, nodeTypeById]);

  const focusSummary = useMemo<FocusSummary | null>(() => {
    if (!hasLockedFocus) return null;

    const summary: FocusSummary = { commits: 0, leaks: 0, teams: 0, jira: 0, slack: 0, github: 0 };
    for (const nodeId of connectedIds) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      if (node.type === "commit") summary.commits += 1;
      if (node.type === "leak") summary.leaks += 1;
      if (node.type === "team") summary.teams += 1;
      if (node.type === "jira") summary.jira += 1;
      if (node.type === "slack") summary.slack += 1;
      if (node.type === "github") summary.github += 1;
    }
    return summary;
  }, [hasLockedFocus, connectedIds, nodeMap]);

  const lockedFocusLabel = useMemo(() => {
    if (!hasLockedFocus) return null;
    if (lockedFocusIds.length === 1) {
      const onlyId = lockedFocusIds[0];
      return nodeMap.get(onlyId)?.label || onlyId;
    }
    return `${lockedFocusIds.length} nodes`;
  }, [hasLockedFocus, lockedFocusIds, nodeMap]);

  const focusOrderById = useMemo(
    () => new Map(lockedFocusIds.map((nodeId, index) => [nodeId, index + 1] as const)),
    [lockedFocusIds],
  );

  const focusSequenceEntries = useMemo(
    () => lockedFocusIds.map((nodeId, index) => {
      const node = nodeMap.get(nodeId);
      return {
        nodeId,
        order: index + 1,
        label: node?.label ?? nodeId,
        type: node?.type ?? null,
        isLatest: index === lockedFocusIds.length - 1,
      };
    }),
    [lockedFocusIds, nodeMap],
  );

  const detailNode = useMemo(() => {
    let detailId: string | null = null;

    if (hasLockedFocus) {
      detailId = lastLockedId && lockedFocusSet.has(lastLockedId)
        ? lastLockedId
        : lockedFocusIds[lockedFocusIds.length - 1] ?? lockedFocusIds[0] ?? null;
    } else if (hoveredId) {
      detailId = hoveredId;
    }

    if (!detailId) return null;
    return nodeMap.get(detailId) ?? null;
  }, [hasLockedFocus, hoveredId, lastLockedId, lockedFocusIds, lockedFocusSet, nodeMap]);

  const detailCommit = useMemo(() => {
    if (!detailNode || detailNode.type !== "commit") return null;
    return commitsById.get(unwrapNodeEntityId(detailNode.id)) ?? null;
  }, [commitsById, detailNode]);

  const detailLeak = useMemo(() => {
    if (!detailNode || detailNode.type !== "leak") return null;
    return leaksById.get(unwrapNodeEntityId(detailNode.id)) ?? null;
  }, [detailNode, leaksById]);

  const detailLeakTeamName = useMemo(() => {
    if (!detailLeak) return null;
    if (!detailLeak.team_id) return "Unscoped";
    return teamsById.get(detailLeak.team_id)?.name ?? detailLeak.team_id;
  }, [detailLeak, teamsById]);

  const detailTeam = useMemo(() => {
    if (!detailNode || detailNode.type !== "team") return null;
    return teamsById.get(unwrapNodeEntityId(detailNode.id)) ?? null;
  }, [detailNode, teamsById]);

  const detailEntity = useMemo(() => {
    if (!detailNode) return null;
    if (detailNode.type !== "jira" && detailNode.type !== "slack" && detailNode.type !== "github") return null;
    return detailNode.entity || null;
  }, [detailNode]);

  const detailEntityTeamNames = useMemo(() => {
    if (!detailEntity?.team_ids?.length) return [] as string[];
    return detailEntity.team_ids.map((teamId) => teamsById.get(teamId)?.name ?? teamId);
  }, [detailEntity, teamsById]);

  const detailCommitEdgeCounts = useMemo(() => {
    if (!detailCommit?.edges?.length) return [] as Array<{ edge_type: string; count: number }>;
    const edgeCounts = new Map<string, number>();
    for (const edge of detailCommit.edges) {
      edgeCounts.set(edge.edge_type, (edgeCounts.get(edge.edge_type) || 0) + 1);
    }
    return Array.from(edgeCounts.entries())
      .map(([edge_type, count]) => ({ edge_type, count }))
      .sort((a, b) => a.edge_type.localeCompare(b.edge_type));
  }, [detailCommit]);

  const detailTeamCounts = useMemo(() => {
    if (!detailTeam) return { commits: 0, leaks: 0 };
    const isUnscoped = detailTeam.id === "unscoped";
    const commitCount = commits.filter((commit) => (isUnscoped ? !commit.team_id : commit.team_id === detailTeam.id)).length;
    const leakCount = leaks.filter((leak) => (isUnscoped ? !leak.team_id : leak.team_id === detailTeam.id)).length;
    return { commits: commitCount, leaks: leakCount };
  }, [commits, detailTeam, leaks]);

  const entityAvailability = useMemo(
    () => ({
      jira: entities.some((entity) => entity.provider === "jira"),
      slack: entities.some((entity) => entity.provider === "slack"),
      github: entities.some((entity) => entity.provider === "github"),
    }),
    [entities],
  );

  const entityCapReached = initialLayout.entityStats.totalEligible > initialLayout.entityStats.rendered;

  const hoveredInferredEdge = useMemo(() => {
    if (!hoveredInferredEdgeId) return null;
    const edge = initialLayout.edges.find((candidate) => candidate.id === hoveredInferredEdgeId);
    if (!edge) return null;
    if (edge.type !== "inferred_link") return null;
    return edge;
  }, [hoveredInferredEdgeId, initialLayout.edges]);

  const hoveredInferredEdgeLabels = useMemo(() => {
    if (!hoveredInferredEdge) return null;
    const sourceLabel = nodeMap.get(hoveredInferredEdge.source)?.label || hoveredInferredEdge.source;
    const targetLabel = nodeMap.get(hoveredInferredEdge.target)?.label || hoveredInferredEdge.target;
    return { sourceLabel, targetLabel };
  }, [hoveredInferredEdge, nodeMap]);

  const selectedRoute = useMemo(
    () => savedRoutes.find((route) => route.id === selectedRouteId) || null,
    [savedRoutes, selectedRouteId],
  );

  const filteredNodeIds = useMemo(() => {
    if (!hasGraphFilters) return new Set<string>();

    const normalizedTagFilters = activeFilterState.tagFilters.map(normalizeToken);
    const normalizedJira = normalizeToken(activeFilterState.jiraKeyFilter);
    const normalizedPr = normalizeToken(activeFilterState.prFilter);
    const normalizedSlack = normalizeToken(activeFilterState.slackChannelFilter);

    const entityByCommit = new Map<string, {
      jira: Set<string>;
      github: Set<string>;
      slack: Set<string>;
    }>();

    for (const entity of entities) {
      for (const commitId of entity.commit_ids) {
        const bucket = entityByCommit.get(commitId) || {
          jira: new Set<string>(),
          github: new Set<string>(),
          slack: new Set<string>(),
        };

        if (entity.provider === "jira") bucket.jira.add(normalizeToken(entity.entity_id));
        if (entity.provider === "github") bucket.github.add(normalizeToken(entity.entity_id));
        if (entity.provider === "slack") bucket.slack.add(normalizeToken(entity.entity_id));

        entityByCommit.set(commitId, bucket);
      }
    }

    const matchedCommitIds = new Set<string>();
    const commitScopedFiltersActive = Boolean(
      activeFilterState.typeFilter !== "all"
      || activeFilterState.statusFilter !== "all"
      || activeFilterState.branchFilter
      || normalizedTagFilters.length > 0
      || normalizedJira
      || normalizedPr
      || normalizedSlack,
    );

    for (const commit of commits) {
      const commitEntities = entityByCommit.get(commit.id) || {
        jira: new Set<string>(),
        github: new Set<string>(),
        slack: new Set<string>(),
      };

      const matchesType = activeFilterState.typeFilter === "all" || commit.commit_type === activeFilterState.typeFilter;
      const matchesStatus = activeFilterState.statusFilter === "all" || commit.status === activeFilterState.statusFilter;
      const matchesBranch = !activeFilterState.branchFilter || normalizeToken(commit.branch_name) === normalizeToken(activeFilterState.branchFilter);
      const matchesDate = isDateWithinRange(commit.created_at, activeFilterState.dateFrom, activeFilterState.dateTo);

      const commitTags = (commit.tags || []).map(normalizeToken);
      const matchesTags = normalizedTagFilters.length === 0
        || normalizedTagFilters.some((tag) => commitTags.includes(tag));

      const matchesJira = !normalizedJira || commitEntities.jira.has(normalizedJira);
      const matchesPr = !normalizedPr || commitEntities.github.has(normalizedPr);
      const matchesSlack = !normalizedSlack || commitEntities.slack.has(normalizedSlack);

      if (
        matchesType
        && matchesStatus
        && matchesBranch
        && matchesDate
        && matchesTags
        && matchesJira
        && matchesPr
        && matchesSlack
      ) {
        matchedCommitIds.add(commit.id);
      }
    }

    const leakToCommitIds = new Map<string, Set<string>>();
    for (const commit of commits) {
      for (const edge of commit.edges || []) {
        if (edge.edge_type !== "triggered_by" || edge.target_type !== "leak_instance") continue;
        const commitSet = leakToCommitIds.get(edge.target_id) || new Set<string>();
        commitSet.add(commit.id);
        leakToCommitIds.set(edge.target_id, commitSet);
      }
    }

    const matchedLeakIds = new Set<string>();
    for (const leak of leaks) {
      const linkedCommitIds = leakToCommitIds.get(leak.id) || new Set<string>();
      const linkedCommitMatch = Array.from(linkedCommitIds).some((commitId) => matchedCommitIds.has(commitId));
      const leakDateMatch = isDateWithinRange(leak.created_at, activeFilterState.dateFrom, activeFilterState.dateTo);

      const matchesLeak = commitScopedFiltersActive
        ? linkedCommitMatch && leakDateMatch
        : leakDateMatch || linkedCommitMatch;

      if (matchesLeak) matchedLeakIds.add(leak.id);
    }

    const matchedNodeIds = new Set<string>();
    const matchedTeamIds = new Set<string>();

    for (const commitId of matchedCommitIds) {
      matchedNodeIds.add(`commit:${commitId}`);
      const commitTeamId = commitsById.get(commitId)?.team_id || "unscoped";
      matchedTeamIds.add(commitTeamId);
    }

    for (const leakId of matchedLeakIds) {
      matchedNodeIds.add(`leak:${leakId}`);
      const leakTeamId = leaksById.get(leakId)?.team_id || "unscoped";
      matchedTeamIds.add(leakTeamId);
    }

    for (const node of initialLayout.nodes) {
      if (!node.entity) continue;

      const connectedCommitMatch = node.entity.commit_ids.some((commitId) => matchedCommitIds.has(commitId));
      const directProviderMatch = (
        (node.entity.provider === "jira" && normalizedJira && normalizeToken(node.entity.entity_id) === normalizedJira)
        || (node.entity.provider === "github" && normalizedPr && normalizeToken(node.entity.entity_id) === normalizedPr)
        || (node.entity.provider === "slack" && normalizedSlack && normalizeToken(node.entity.entity_id) === normalizedSlack)
      );

      if (connectedCommitMatch || directProviderMatch) {
        matchedNodeIds.add(node.id);
        if (node.teamId) matchedTeamIds.add(node.teamId);
      }
    }

    for (const teamIdValue of matchedTeamIds) {
      matchedNodeIds.add(`team:${teamIdValue}`);
    }

    return matchedNodeIds;
  }, [
    activeFilterState,
    commits,
    commitsById,
    entities,
    hasGraphFilters,
    initialLayout.nodes,
    leaks,
    leaksById,
  ]);

  const dispatchTargetPlaceholder = useMemo(() => {
    if (dispatchProvider === "slack") return "#channel or C12345678";
    if (dispatchProvider === "jira") return "JIRA-123";
    return "owner/repo#123";
  }, [dispatchProvider]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < traversalHistoryRef.current.length - 1;

  const undoTraversal = useCallback(() => {
    if (!canUndo) return;
    const nextIndex = historyIndex - 1;
    const snapshot = traversalHistoryRef.current[nextIndex];
    if (!snapshot) return;
    setHistoryIndex(nextIndex);
    applyTraversalState(snapshot);
    setRouteStatusMessage("Traversal undo");
  }, [applyTraversalState, canUndo, historyIndex]);

  const redoTraversal = useCallback(() => {
    if (!canRedo) return;
    const nextIndex = historyIndex + 1;
    const snapshot = traversalHistoryRef.current[nextIndex];
    if (!snapshot) return;
    setHistoryIndex(nextIndex);
    applyTraversalState(snapshot);
    setRouteStatusMessage("Traversal redo");
  }, [applyTraversalState, canRedo, historyIndex]);

  const saveCurrentRoute = useCallback(async () => {
    if (createRouteMutation.isPending) return;

    const draftName = routeNameDraft.trim();
    const name = draftName || window.prompt("Route name", `Route ${new Date().toLocaleString()}`);
    if (!name || !name.trim()) return;
    const draftSolution = routeSolutionDraft.trim();
    const solutionDraft = draftSolution || window.prompt("Proposed solution (optional)", "") || "";

    try {
      const snapshot = buildRouteSnapshot();
      const response = await createRouteMutation.mutateAsync({
        name: name.trim(),
        solution_draft: solutionDraft.trim(),
        snapshot,
        dataset_signature: snapshot.datasetSignature,
        team_id: teamId,
        project_id: projectId,
        created_by: "graph_ui",
      });

      const entry = mapSavedRouteRow(response.route);
      setSavedRoutes((prev) => {
        const withoutExisting = prev.filter((route) => route.id !== entry.id);
        return [entry, ...withoutExisting].slice(0, MAX_SAVED_ROUTES);
      });
      setSelectedRouteId(entry.id);
      setRouteNameDraft(entry.name);
      setRouteSolutionDraft(entry.solutionDraft);
      setRouteStatusMessage(`Saved route "${entry.name}"`);
      await queryClient.invalidateQueries({ queryKey: routesQueryKey });
    } catch (error) {
      setRouteStatusMessage(getErrorMessage(error, "Failed to save route"));
    }
  }, [
    buildRouteSnapshot,
    createRouteMutation,
    projectId,
    queryClient,
    routeNameDraft,
    routesQueryKey,
    routeSolutionDraft,
    teamId,
  ]);

  const persistSelectedRouteEdits = useCallback(async (): Promise<SavedRouteEntry | null> => {
    if (!selectedRoute) return null;

    const nextName = routeNameDraft.trim() || selectedRoute.name;
    const nextSolutionDraft = routeSolutionDraft.trim();
    const currentSolutionDraft = selectedRoute.solutionDraft.trim();

    if (nextName === selectedRoute.name && nextSolutionDraft === currentSolutionDraft) {
      return selectedRoute;
    }

    const response = await updateRouteMutation.mutateAsync({
      routeId: selectedRoute.id,
      name: nextName,
      solution_draft: nextSolutionDraft || null,
    });

    const updated = mapSavedRouteRow(response.route);
    setSavedRoutes((prev) => {
      const withoutCurrent = prev.filter((route) => route.id !== updated.id);
      return [updated, ...withoutCurrent];
    });
    setRouteNameDraft(updated.name);
    setRouteSolutionDraft(updated.solutionDraft);
    setRouteStatusMessage(`Updated route "${updated.name}"`);
    await queryClient.invalidateQueries({ queryKey: routesQueryKey });
    return updated;
  }, [
    queryClient,
    routeNameDraft,
    routeSolutionDraft,
    routesQueryKey,
    selectedRoute,
    updateRouteMutation,
  ]);

  const restoreSelectedRoute = useCallback(() => {
    if (!selectedRoute) return;
    if (selectedRoute.snapshot.datasetSignature !== datasetSignature) {
      setRouteStatusMessage("Route data no longer matches current graph scope");
      return;
    }
    applyRouteSnapshot(selectedRoute.snapshot);
    setRouteStatusMessage(`Restored "${selectedRoute.name}"`);
  }, [applyRouteSnapshot, datasetSignature, selectedRoute]);

  const deleteSelectedRoute = useCallback(async () => {
    if (!selectedRoute) return;
    if (deleteRouteMutation.isPending) return;

    const confirmed = window.confirm(`Delete saved route "${selectedRoute.name}"?`);
    if (!confirmed) return;

    try {
      await deleteRouteMutation.mutateAsync(selectedRoute.id);
      setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedRoute.id));
      setSelectedRouteId("");
      setRouteStatusMessage("Saved route deleted");
      await queryClient.invalidateQueries({ queryKey: routesQueryKey });
    } catch (error) {
      setRouteStatusMessage(getErrorMessage(error, "Failed to delete route"));
    }
  }, [deleteRouteMutation, queryClient, routesQueryKey, selectedRoute]);

  const copyReviewPacket = useCallback(async () => {
    if (!selectedRoute) return;
    const payload = {
      route_name: selectedRoute.name,
      created_at: selectedRoute.createdAt,
      proposed_solution: selectedRoute.solutionDraft || null,
      focus_nodes: selectedRoute.snapshot.traversal.lockedFocusIds,
      traversal: selectedRoute.snapshot.traversal,
      dataset_signature: selectedRoute.snapshot.datasetSignature,
      captured_at: selectedRoute.snapshot.capturedAt,
    };

    const text = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      setRouteStatusMessage("Review packet copied to clipboard");
    } catch {
      window.prompt("Copy review packet", text);
    }
  }, [selectedRoute]);

  const dispatchSelectedRoute = useCallback(async () => {
    if (!selectedRoute) return;
    if (dispatchRouteMutation.isPending) return;

    const target = dispatchTarget.trim();
    if (!target) {
      setRouteStatusMessage("Dispatch target is required");
      return;
    }

    try {
      const latestRoute = await persistSelectedRouteEdits();
      const routeToDispatch = latestRoute || selectedRoute;

      await dispatchRouteMutation.mutateAsync({
        routeId: routeToDispatch.id,
        provider: dispatchProvider,
        target,
        actor: "graph_ui",
      });
      setRouteStatusMessage(`Review packet sent to ${dispatchProvider}`);
      await queryClient.invalidateQueries({ queryKey: routesQueryKey });
    } catch (error) {
      setRouteStatusMessage(getErrorMessage(error, "Failed to dispatch review packet"));
    }
  }, [
    dispatchProvider,
    dispatchRouteMutation,
    dispatchTarget,
    persistSelectedRouteEdits,
    queryClient,
    routesQueryKey,
    selectedRoute,
  ]);

  const clearFocus = useCallback(() => {
    setLockedFocusIds([]);
    setLastLockedId(null);
    setFocusDepth(1);
    setHoveredId(null);
  }, []);

  useEffect(() => {
    if (!hasLockedFocus) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearFocus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFocus, hasLockedFocus]);

  const viewportCenterX = size.width / 2;
  const viewportCenterY = size.height / 2;
  const effectiveZoomOffsetX = zoomOffset.x + (1 - zoom) * viewportCenterX;
  const effectiveZoomOffsetY = zoomOffset.y + (1 - zoom) * viewportCenterY;
  const composedScale = graphFitTransform.scale * zoom;
  const composedTranslateX = zoom * graphFitTransform.translateX + effectiveZoomOffsetX;
  const composedTranslateY = zoom * graphFitTransform.translateY + effectiveZoomOffsetY;

  const toGraphCoordinates = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const viewX = ((event.clientX - rect.left) / rect.width) * size.width;
    const viewY = ((event.clientY - rect.top) / rect.height) * size.height;

    const fitX = (viewX - effectiveZoomOffsetX) / zoom;
    const fitY = (viewY - effectiveZoomOffsetY) / zoom;

    return {
      x: (fitX - graphFitTransform.translateX) / graphFitTransform.scale,
      y: (fitY - graphFitTransform.translateY) / graphFitTransform.scale,
    };
  };

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (dragStateRef.current) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      const viewport = graphViewportRef.current;
      if (!viewport || !viewport.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();

      const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;

      if (Math.abs(dominantDelta) < 0.1) return;

      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const viewX = ((event.clientX - rect.left) / rect.width) * size.width;
      const viewY = ((event.clientY - rect.top) / rect.height) * size.height;

      const sensitivity = event.ctrlKey ? 0.0045 : 0.0022;
      setZoom((current) => {
        const next = clamp(current * Math.exp(-dominantDelta * sensitivity), ZOOM_MIN, ZOOM_MAX);
        if (Math.abs(next - current) < 0.00001) return current;

        const ratio = next / current;
        setZoomOffset((existingOffset) => {
          const currentEffectiveX = existingOffset.x + (1 - current) * viewportCenterX;
          const currentEffectiveY = existingOffset.y + (1 - current) * viewportCenterY;
          const nextEffectiveX = viewX - (viewX - currentEffectiveX) * ratio;
          const nextEffectiveY = viewY - (viewY - currentEffectiveY) * ratio;

          return {
            x: nextEffectiveX - (1 - next) * viewportCenterX,
            y: nextEffectiveY - (1 - next) * viewportCenterY,
          };
        });
        return next;
      });
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [size.height, size.width, viewportCenterX, viewportCenterY]);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        await container.requestFullscreen();
      }
    } catch {
      setRouteStatusMessage("Fullscreen is not available in this browser");
    }
  }, []);

  const handlePointerDown = (nodeId: string, interactive: boolean, event: ReactPointerEvent<SVGGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!interactive) return;

    nodePointerDownScrollYRef.current = window.scrollY;
    dragMovedRef.current = false;
    setHoveredId(nodeId);

    const point = toGraphCoordinates(event);
    if (!point) {
      dragStateRef.current = null;
      setDragState(null);
      return;
    }

    const nextDragState: DragState = {
      nodeId,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
    };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture may fail for synthetic/non-primary pointers; continue without capture.
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const activeDragState = dragStateRef.current;
    if (activeDragState && event.pointerId === activeDragState.pointerId) {
      const point = toGraphCoordinates(event);
      if (!point) return;

      if (!dragMovedRef.current) {
        const movedDistance = Math.hypot(point.x - activeDragState.startX, point.y - activeDragState.startY);
        if (movedDistance > 4) {
          dragMovedRef.current = true;
        }
      }

      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id !== activeDragState.nodeId) return node;
          return {
            ...node,
            x: clamp(point.x, node.radius + 8, size.width - node.radius - 8),
            y: clamp(point.y, node.radius + 8, size.height - node.radius - 8),
            vx: 0,
            vy: 0,
          };
        }),
      );
      return;
    }

    const activeCanvasPanState = canvasPanStateRef.current;
    if (!activeCanvasPanState || event.pointerId !== activeCanvasPanState.pointerId) return;

    const viewport = graphViewportRef.current;
    if (!viewport) return;

    const deltaX = event.clientX - activeCanvasPanState.startClientX;
    const deltaY = event.clientY - activeCanvasPanState.startClientY;
    if (!activeCanvasPanState.moved && Math.hypot(deltaX, deltaY) > CANVAS_PAN_THRESHOLD_PX) {
      activeCanvasPanState.moved = true;
    }

    viewport.scrollLeft = activeCanvasPanState.startScrollLeft - deltaX;
    viewport.scrollTop = activeCanvasPanState.startScrollTop - deltaY;
    event.preventDefault();
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;

    const viewport = graphViewportRef.current;
    if (!viewport) return;

    canvasPanStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      moved: false,
    };
    setIsCanvasPanning(true);

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
  };

  const endDrag = (event?: ReactPointerEvent<SVGSVGElement>) => {
    const activeDragState = dragStateRef.current;
    if (activeDragState && (!event || event.pointerId === activeDragState.pointerId)) {
      dragStateRef.current = null;
      dragMovedRef.current = false;
      setDragState(null);
    }

    const activeCanvasPanState = canvasPanStateRef.current;
    if (!activeCanvasPanState || (event && event.pointerId !== activeCanvasPanState.pointerId)) return;

    canvasPanStateRef.current = null;
    setIsCanvasPanning(false);

    if (event && event.currentTarget.hasPointerCapture(activeCanvasPanState.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(activeCanvasPanState.pointerId);
      } catch {
        // Ignore if capture was never established.
      }
    }

    // A background click (without a drag) should keep existing clear-focus behavior.
    if (activeCanvasPanState.moved || !hasLockedFocus) return;

    if (navigationLockEnabled) {
      setRouteStatusMessage("Canvas lock is on. Use Clear Focus or disable lock.");
      return;
    }

    if (lockedFocusIds.length >= 3) {
      const shouldClear = window.confirm("Clear current graph focus selection?");
      if (!shouldClear) {
        return;
      }
    }

    clearFocus();
  };

  const toggleLockedFocus = (nodeId: string) => {
    setLockedFocusIds((prev) => {
      if (!multiFocusEnabled) {
        if (prev.length === 1 && prev[0] === nodeId) {
          setLastLockedId(null);
          return [];
        }
        setLastLockedId(nodeId);
        return [nodeId];
      }

      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      }
      setLastLockedId(nodeId);
      return [...prev, nodeId];
    });
    setHoveredId(nodeId);
  };

  const promoteFocusAnchor = useCallback((nodeId: string) => {
    setLockedFocusIds((prev) => {
      if (!prev.includes(nodeId)) return prev;
      const reordered = prev.filter((id) => id !== nodeId);
      reordered.push(nodeId);
      return reordered;
    });
    setLastLockedId(nodeId);
    setHoveredId(nodeId);
  }, []);

  const toggleMultiFocusMode = () => {
    setMultiFocusEnabled((prev) => {
      const next = !prev;

      if (!next) {
        setLockedFocusIds((current) => {
          if (current.length <= 1) return current;
          const keep = lastLockedId && current.includes(lastLockedId)
            ? lastLockedId
            : current[current.length - 1] ?? null;
          return keep ? [keep] : [];
        });
      }

      return next;
    });
  };

  const handleNodePointerUp = (nodeId: string, interactive: boolean, event: ReactPointerEvent<SVGGElement>) => {
    event.preventDefault();
    if (!interactive) return;

    const activeDragState = dragStateRef.current;
    if (!activeDragState) return;
    if (event.pointerId !== activeDragState.pointerId) return;

    const moved = dragMovedRef.current;
    dragStateRef.current = null;
    dragMovedRef.current = false;
    setDragState(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (moved) {
      return;
    }

    const currentScrollY = nodePointerDownScrollYRef.current ?? window.scrollY;
    nodePointerDownScrollYRef.current = null;

    const recentScroll = Date.now() - windowScrollHistoryRef.current.updatedAt < 1200;
    const smallAutoJumpDetected = recentScroll
      && windowScrollHistoryRef.current.current < windowScrollHistoryRef.current.previous
      && windowScrollHistoryRef.current.previous - windowScrollHistoryRef.current.current <= 120;
    const restoreScrollY = smallAutoJumpDetected
      ? windowScrollHistoryRef.current.previous
      : currentScrollY;

    toggleLockedFocus(nodeId);
    window.requestAnimationFrame(() => {
      if (window.scrollY !== restoreScrollY) {
        window.scrollTo({ top: restoreScrollY, behavior: "auto" });
      }
    });
  };

  const resetLayout = () => {
    setZoom(computeOverviewZoom());
    setZoomOffset({ x: 0, y: 0 });
    setNodes(cloneNodes(initialNodesRef.current));
    setHoveredId(null);
    setLockedFocusIds([]);
    setLastLockedId(null);
    setFocusDepth(1);
    dragStateRef.current = null;
    setDragState(null);
    dragMovedRef.current = false;
    window.requestAnimationFrame(() => {
      centerGraphViewport();
    });
    setRouteStatusMessage("Graph layout reset");
  };

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden border border-gray-800 bg-gray-950/50 ${isFullscreen ? "h-full rounded-none" : "rounded-lg"}`}
    >
      <div className="px-3 py-2 border-b border-gray-800 space-y-2">
        {/* ── Row 1: Primary toolbar ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Navigation group */}
          <div className="flex flex-wrap items-center gap-1 pr-2 mr-2 border-r border-gray-800/60 [&>*]:shrink-0 [&>button]:whitespace-nowrap">
            <button
              type="button"
              className={`h-7 px-2 rounded border text-xs ${
                multiFocusEnabled
                  ? "border-cyan-600/40 text-cyan-300 bg-cyan-950/40"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
              }`}
              onClick={toggleMultiFocusMode}
            >
              Multi-focus: {multiFocusEnabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs disabled:opacity-40"
              onClick={undoTraversal}
              disabled={!canUndo}
            >
              Undo
            </button>
            <button
              type="button"
              className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs disabled:opacity-40"
              onClick={redoTraversal}
              disabled={!canRedo}
            >
              Redo
            </button>
            <button
              type="button"
              className={`h-7 px-2 rounded border text-xs ${
                navigationLockEnabled
                  ? "border-emerald-600/40 text-emerald-300 bg-emerald-950/30"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
              }`}
              onClick={() => setNavigationLockEnabled((value) => !value)}
            >
              Canvas Lock: {navigationLockEnabled ? "On" : "Off"}
            </button>
            {hasLockedFocus && (
              <button
                type="button"
                className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs"
                onClick={() => setFocusDepth((prev) => (prev === 1 ? 2 : 1))}
              >
                Context: {focusDepth}-hop
              </button>
            )}
            {hasLockedFocus && (
              <button
                type="button"
                className="h-7 px-2 rounded border border-cyan-600/40 text-cyan-300 hover:bg-cyan-950/50 text-xs"
                onClick={clearFocus}
              >
                Clear Focus
              </button>
            )}
          </div>

          {/* Sources group */}
          <div className="flex flex-wrap items-center gap-1 pr-2 mr-2 border-r border-gray-800/60 [&>*]:shrink-0 [&>button]:whitespace-nowrap">
            <span className="text-[10px] uppercase tracking-wider text-gray-600 mr-0.5">Sources</span>
            <button
              type="button"
              className={`h-7 px-2 rounded border text-xs ${
                showJiraEntities
                  ? "border-blue-500/50 text-blue-300 bg-blue-950/30"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={() => setShowJiraEntities((value) => !value)}
              disabled={!entityAvailability.jira}
            >
              Jira
            </button>
            <button
              type="button"
              className={`h-7 px-2 rounded border text-xs ${
                showSlackEntities
                  ? "border-fuchsia-500/50 text-fuchsia-300 bg-fuchsia-950/30"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={() => setShowSlackEntities((value) => !value)}
              disabled={!entityAvailability.slack}
            >
              Slack
            </button>
            <button
              type="button"
              className={`h-7 px-2 rounded border text-xs ${
                showGithubEntities
                  ? "border-emerald-500/50 text-emerald-300 bg-emerald-950/30"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={() => setShowGithubEntities((value) => !value)}
              disabled={!entityAvailability.github}
            >
              GitHub
            </button>
          </div>

          {/* View controls group */}
          <div className="flex flex-wrap items-center gap-1 [&>*]:shrink-0 [&>button]:whitespace-nowrap">
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs"
              onClick={() => {
                const anchorX = size.width / 2;
                const anchorY = size.height / 2;
                setZoom((current) => {
                  const next = clamp(current - 0.15, ZOOM_MIN, ZOOM_MAX);
                  if (Math.abs(next - current) < 0.00001) return current;
                  const ratio = next / current;
                  setZoomOffset((existingOffset) => {
                    const currentEffectiveX = existingOffset.x + (1 - current) * anchorX;
                    const currentEffectiveY = existingOffset.y + (1 - current) * anchorY;
                    const nextEffectiveX = anchorX - (anchorX - currentEffectiveX) * ratio;
                    const nextEffectiveY = anchorY - (anchorY - currentEffectiveY) * ratio;

                    return {
                      x: nextEffectiveX - (1 - next) * anchorX,
                      y: nextEffectiveY - (1 - next) * anchorY,
                    };
                  });
                  return next;
                });
              }}
            >
              -
            </button>
            <button
              type="button"
              className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs"
              onClick={resetLayout}
            >
              Reset
            </button>
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs"
              onClick={() => {
                const anchorX = size.width / 2;
                const anchorY = size.height / 2;
                setZoom((current) => {
                  const next = clamp(current + 0.15, ZOOM_MIN, ZOOM_MAX);
                  if (Math.abs(next - current) < 0.00001) return current;
                  const ratio = next / current;
                  setZoomOffset((existingOffset) => {
                    const currentEffectiveX = existingOffset.x + (1 - current) * anchorX;
                    const currentEffectiveY = existingOffset.y + (1 - current) * anchorY;
                    const nextEffectiveX = anchorX - (anchorX - currentEffectiveX) * ratio;
                    const nextEffectiveY = anchorY - (anchorY - currentEffectiveY) * ratio;

                    return {
                      x: nextEffectiveX - (1 - next) * anchorX,
                      y: nextEffectiveY - (1 - next) * anchorY,
                    };
                  });
                  return next;
                });
              }}
            >
              +
            </button>
            <button
              type="button"
              className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs"
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
            <span className="text-[10px] text-gray-600 ml-1">Scroll or pinch to zoom</span>
            <div className="flex items-center gap-1.5 ml-1">
              <label className="text-[10px] text-gray-500">Density</label>
              <input
                type="range"
                min={25}
                max={100}
                step={1}
                value={density}
                onChange={(event) => setDensity(Number(event.target.value))}
                className="w-24 accent-cyan-500"
                aria-label="Node density"
              />
              <span className="text-[10px] text-gray-600 w-6">{density}</span>
            </div>
          </div>
        </div>

        {/* ── Row 2: Routes panel ── */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-800/50 bg-gray-900/30 px-2 py-1.5 [&>*]:shrink-0 [&>button]:whitespace-nowrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 mr-0.5">Routes</span>
          <select
            className="h-7 px-2 rounded border border-gray-700 bg-gray-900 text-gray-300 text-xs"
            value={selectedRouteId}
            onChange={(event) => setSelectedRouteId(event.target.value)}
            disabled={persistedRoutesQuery.isLoading}
          >
            <option value="">Saved routes</option>
            {savedRoutes.map((route) => (
              <option key={route.id} value={route.id}>{route.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs disabled:opacity-40"
            onClick={restoreSelectedRoute}
            disabled={!selectedRoute}
          >
            Restore
          </button>
          <div className="w-px h-5 bg-gray-800/60 mx-0.5" />
          <button
            type="button"
            className="h-7 px-2 rounded border border-cyan-700/40 text-cyan-300 hover:bg-cyan-950/40 text-xs disabled:opacity-40"
            onClick={() => void saveCurrentRoute()}
            disabled={createRouteMutation.isPending}
          >
            {createRouteMutation.isPending ? "Saving..." : "Save Route"}
          </button>
          <input
            type="text"
            className="h-7 w-full sm:w-36 px-2 rounded border border-gray-700 bg-gray-900 text-gray-300 text-xs"
            placeholder="Route name"
            value={routeNameDraft}
            onChange={(event) => setRouteNameDraft(event.target.value)}
          />
          <input
            type="text"
            className="h-7 w-full sm:w-48 px-2 rounded border border-gray-700 bg-gray-900 text-gray-300 text-xs"
            placeholder="User-provided solution draft"
            value={routeSolutionDraft}
            onChange={(event) => setRouteSolutionDraft(event.target.value)}
          />
          {selectedRoute && (
            <>
              <div className="w-px h-5 bg-gray-800/60 mx-0.5" />
              <button
                type="button"
                className="h-7 px-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs disabled:opacity-40"
                onClick={copyReviewPacket}
                disabled={!selectedRoute}
              >
                Copy Review Packet
              </button>
              <button
                type="button"
                className="h-7 px-2 rounded border border-cyan-700/40 text-cyan-300 hover:bg-cyan-950/30 text-xs disabled:opacity-40"
                onClick={() => void persistSelectedRouteEdits()}
                disabled={!selectedRoute || updateRouteMutation.isPending}
              >
                {updateRouteMutation.isPending ? "Updating..." : "Save Draft"}
              </button>
              <button
                type="button"
                className="h-7 px-2 rounded border border-red-700/40 text-red-300 hover:bg-red-950/30 text-xs disabled:opacity-40"
                onClick={() => void deleteSelectedRoute()}
                disabled={!selectedRoute || deleteRouteMutation.isPending}
              >
                {deleteRouteMutation.isPending ? "Deleting..." : "Delete Route"}
              </button>
            </>
          )}
        </div>

        {/* ── Row 3: Dispatch (only when route selected) ── */}
        {selectedRoute && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-800/30 bg-emerald-950/10 px-2 py-1.5 [&>*]:shrink-0 [&>button]:whitespace-nowrap">
            <span className="text-[10px] uppercase tracking-wider text-emerald-600 mr-0.5">Dispatch</span>
            <span className="text-[11px] text-gray-400 truncate max-w-[200px]">
              Route: <span className="text-cyan-300">{selectedRoute.name}</span>
            </span>
            {selectedRoute.solutionDraft && (
              <span className="text-[11px] text-gray-600 truncate max-w-[180px]">({selectedRoute.solutionDraft.slice(0, 60)})</span>
            )}
            <div className="w-px h-5 bg-emerald-800/30 mx-0.5" />
            <select
              className="h-7 px-2 rounded border border-gray-700 bg-gray-900 text-gray-300 text-xs"
              value={dispatchProvider}
              onChange={(event) => setDispatchProvider(event.target.value as "slack" | "jira" | "github")}
            >
              <option value="slack">Slack</option>
              <option value="jira">Jira</option>
              <option value="github">GitHub</option>
            </select>
            <input
              type="text"
              className="h-7 w-full sm:w-48 px-2 rounded border border-gray-700 bg-gray-900 text-gray-300 text-xs"
              value={dispatchTarget}
              onChange={(event) => setDispatchTarget(event.target.value)}
              placeholder={dispatchTargetPlaceholder}
            />
            <button
              type="button"
              className="h-7 px-2 rounded border border-emerald-700/40 text-emerald-300 hover:bg-emerald-950/30 text-xs disabled:opacity-40"
              onClick={() => void dispatchSelectedRoute()}
              disabled={!dispatchTarget.trim() || dispatchRouteMutation.isPending}
            >
              {dispatchRouteMutation.isPending ? "Sending..." : "Send Review"}
            </button>
          </div>
        )}

        {/* ── Status strip ── */}
        {(hasLockedFocus || hasGraphFilters || depthCapped || entityCapReached || routeStatusMessage) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] px-0.5">
            {hasLockedFocus && lockedFocusLabel && (
              <span className="text-cyan-300">
                Focus: {lockedFocusLabel}
                {focusSummary && (
                  <span className="text-gray-500 ml-2">
                    ({focusSummary.commits} commits, {focusSummary.leaks} leaks, {focusSummary.teams} teams,
                    {" "}{focusSummary.jira + focusSummary.slack + focusSummary.github} sources)
                  </span>
                )}
              </span>
            )}
            {depthCapped && (
              <span className="text-amber-300">Depth capped to 1-hop (4+ nodes locked)</span>
            )}
            {entityCapReached && (
              <span className="text-amber-300">Source nodes capped at {MAX_VISIBLE_ENTITY_NODES} (toggle filters to narrow)</span>
            )}
            {hasGraphFilters && (
              <span className="text-cyan-300">Filter mode: {filteredNodeIds.size} highlighted / {nodes.length} nodes</span>
            )}
            {routeStatusMessage && (
              <span className="text-emerald-300">{routeStatusMessage}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col xl:flex-row">
      <div
        ref={graphViewportRef}
        className={`relative min-w-0 flex-1 overflow-auto overscroll-contain select-none ${isFullscreen ? "h-[calc(100vh-150px)]" : "h-[80vh] min-h-[680px] max-h-[1200px]"}`}
      >
      {hoveredInferredEdge && hoveredInferredEdgeLabels && (
        <div className="absolute left-3 bottom-3 z-20 max-w-[min(520px,calc(100%-1.5rem))] rounded-md border border-amber-700/40 bg-amber-950/95 p-3 space-y-2 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-amber-300">Inferred Link</span>
            <span className="text-[11px] text-gray-400">
              {hoveredInferredEdge.inferredTier || "unknown"}
              {typeof hoveredInferredEdge.inferredConfidence === "number" && (
                <span className="ml-1">({Math.round(hoveredInferredEdge.inferredConfidence * 100)}%)</span>
              )}
            </span>
          </div>

          <p className="text-xs text-gray-300">
            {hoveredInferredEdgeLabels.sourceLabel} ↔ {hoveredInferredEdgeLabels.targetLabel}
          </p>

          <p className="text-[11px] text-gray-500">
            {describeInferenceReason(hoveredInferredEdge.inferredReason)}
          </p>

          {hoveredInferredEdge.inferredLinkId && hoveredInferredEdge.inferredStatus !== "confirmed" && hoveredInferredEdge.inferredTier === "medium" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-7 px-2 rounded border border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/40 text-xs disabled:opacity-50"
                disabled={updateInferredStatus.isPending}
                onClick={() => {
                  updateInferredStatus.mutate({
                    id: hoveredInferredEdge.inferredLinkId as string,
                    status: "confirmed",
                  });
                }}
              >
                Confirm Link
              </button>
              <button
                type="button"
                className="h-7 px-2 rounded border border-red-600/40 text-red-300 hover:bg-red-950/40 text-xs disabled:opacity-50"
                disabled={updateInferredStatus.isPending}
                onClick={() => {
                  updateInferredStatus.mutate({
                    id: hoveredInferredEdge.inferredLinkId as string,
                    status: "dismissed",
                  });
                }}
              >
                Dismiss Link
              </button>
            </div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="block"
        style={{ width: size.width, minHeight: MIN_GRAPH_HEIGHT, touchAction: "none", cursor: isCanvasPanning ? "grabbing" : "grab" }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <g
          transform={`matrix(${composedScale} 0 0 ${composedScale} ${composedTranslateX} ${composedTranslateY})`}
          onPointerDown={handleCanvasPointerDown}
        >
          {initialLayout.teamBands.map((band, index) => {
            const bandWidth = band.endX - band.startX;
            return (
              <g key={`band:${band.teamId}`}>
                <rect
                  x={band.startX}
                  y={10}
                  width={bandWidth}
                  height={size.height - 20}
                  fill={withHexAlpha(band.color, "10")}
                  stroke={withHexAlpha(band.color, "2a")}
                  strokeWidth={0.6}
                  rx={6}
                />
                {index > 0 && (
                  <line
                    x1={band.startX}
                    y1={20}
                    x2={band.startX}
                    y2={size.height - 20}
                    stroke={withHexAlpha("#94a3b8", "40")}
                    strokeDasharray="3,4"
                    strokeWidth={0.6}
                  />
                )}
                <text
                  x={band.startX + bandWidth / 2}
                  y={26}
                  textAnchor="middle"
                  fontSize={9}
                  fill={withHexAlpha(band.color, "d0")}
                  fontWeight={600}
                >
                  {band.label}
                </text>
              </g>
            );
          })}

          {initialLayout.edges.map((edge, index) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            if (edge.type === "inferred_link" && edge.inferredTier === "weak") {
              return null;
            }

            const isHighlighted = Boolean(hasActiveFocus && connectedIds.has(edge.source) && connectedIds.has(edge.target));
            const isFilterHighlighted = !hasGraphFilters
              || (filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target));
            const path = edgePath(source, target, edge.curveOffset);

            const inferredStroke = edge.type === "inferred_link"
              ? edge.inferredTier === "medium"
                ? "#f59e0b"
                : "#38bdf8"
              : null;

            const strokeColor = edge.isCrossTeam
              ? "#22d3ee"
              : inferredStroke
                ? inferredStroke
              : edge.type === "triggered_by"
                ? "#ef4444"
                : edge.type === "depends_on"
                  ? "#6366f1"
                  : edge.type === "linked_entity"
                    ? target.color
                    : edge.type === "inferred_link"
                      ? "#38bdf8"
                  : edge.type === "owned_by"
                    ? "#f59e0b"
                    : "#475569";

            const inferredStrokePattern = edge.type === "inferred_link"
              ? edge.inferredTier === "explicit"
                ? undefined
                : edge.inferredTier === "strong"
                  ? "6,3"
                  : "2,4"
              : undefined;

            const canHoverInference = edge.type === "inferred_link" && Boolean(edge.inferredLinkId);

            return (
              <path
                key={edge.id || `${edge.source}-${edge.target}-${edge.type}-${index}`}
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeWidth={
                  isHighlighted
                    ? 2
                    : edge.type === "inferred_link"
                      ? 1.5
                      : edge.isCrossTeam
                        ? 1.3
                        : 0.9
                }
                strokeOpacity={
                  hasActiveFocus
                    ? (isHighlighted ? 0.92 : 0.14)
                    : hasGraphFilters
                      ? (isFilterHighlighted
                        ? (edge.type === "inferred_link" ? 0.82 : edge.isCrossTeam ? 0.8 : 0.56)
                        : 0.1)
                      : edge.type === "inferred_link"
                        ? 0.76
                        : edge.isCrossTeam
                          ? 0.78
                          : 0.45
                }
                strokeDasharray={
                  inferredStrokePattern
                    ? inferredStrokePattern
                  :
                  edge.isCrossTeam
                    ? "5,3"
                    : edge.type === "depends_on"
                      ? "4,2"
                      : edge.type === "linked_entity"
                        ? "3,3"
                      : edge.type === "owned_by"
                        ? "2,3"
                        : undefined
                }
                onMouseEnter={() => {
                  if (canHoverInference) {
                    setHoveredInferredEdgeId(edge.id);
                  }
                }}
                onMouseLeave={() => {
                  if (canHoverInference) {
                    setHoveredInferredEdgeId((current) => (current === edge.id ? null : current));
                  }
                }}
                style={canHoverInference ? { cursor: "pointer" } : undefined}
              />
            );
          })}

          {nodes.map((node) => {
            const isHovered = hoveredId === node.id;
            const isFocusAnchor = lockedFocusSet.has(node.id);
            const isConnected = connectedIds.has(node.id);
            const isFilterMatch = !hasGraphFilters || filteredNodeIds.has(node.id);
            const isContextVisible = hasActiveFocus && isConnected;
            const isDimmedByFilter = hasGraphFilters && !isFilterMatch && !isContextVisible;

            const opacity = hasActiveFocus
              ? (isConnected ? 1 : (isDimmedByFilter ? 0.08 : 0.16))
              : hasGraphFilters
                ? (isFilterMatch ? 1 : 0.18)
                : 1;

            const isInteractive = hasActiveFocus
              ? isConnected
              : hasGraphFilters
                ? isFilterMatch
                : true;
            const showLabel = node.type === "team"
              || isHovered
              || isFocusAnchor
              || (hasActiveFocus ? directNeighborIds.has(node.id) : node.radius >= 10.5);
            const isDragging = dragState?.nodeId === node.id;
            const focusOrder = focusOrderById.get(node.id) ?? null;
            const isLatestFocus = focusOrder === lockedFocusIds.length;

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => {
                  if (!dragStateRef.current && !hasLockedFocus) setHoveredId(null);
                }}
                onPointerDown={(event) => handlePointerDown(node.id, isInteractive, event)}
                onPointerUp={(event) => handleNodePointerUp(node.id, isInteractive, event)}
                style={{
                  cursor: isInteractive ? (isDragging ? "grabbing" : "grab") : "not-allowed",
                  opacity,
                }}
              >
                {node.type === "team" ? (
                  <rect
                    x={node.x - node.radius}
                    y={node.y - node.radius}
                    width={node.radius * 2}
                    height={node.radius * 2}
                    rx={5}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                ) : node.type === "leak" ? (
                  <polygon
                    points={`${node.x},${node.y - node.radius} ${node.x + node.radius},${node.y + node.radius} ${node.x - node.radius},${node.y + node.radius}`}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                ) : node.type === "jira" ? (
                  <polygon
                    points={regularPolygonPoints(node.x, node.y, node.radius + 1, 6, Math.PI / 6)}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                ) : node.type === "slack" ? (
                  <rect
                    x={node.x - node.radius - 1}
                    y={node.y - node.radius + 1}
                    width={(node.radius + 1) * 2}
                    height={(node.radius - 1) * 2}
                    rx={4}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                ) : node.type === "github" ? (
                  <polygon
                    points={regularPolygonPoints(node.x, node.y, node.radius + 1, 8, Math.PI / 8)}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                ) : (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={withHexAlpha(node.color, "2f")}
                    stroke={node.color}
                    strokeWidth={isHovered || isDragging || isFocusAnchor ? 2.3 : 1.35}
                  />
                )}

                {focusOrder && (
                  <g>
                    <circle
                      cx={node.x + node.radius + 7}
                      cy={node.y - node.radius - 7}
                      r={7}
                      fill={isLatestFocus ? "#0f766e" : "#111827"}
                      stroke={isLatestFocus ? "#2dd4bf" : "#374151"}
                      strokeWidth={1.2}
                    />
                    <text
                      x={node.x + node.radius + 7}
                      y={node.y - node.radius - 4.5}
                      textAnchor="middle"
                      fontSize={8}
                      fill="#e5e7eb"
                      fontWeight={700}
                    >
                      {focusOrder}
                    </text>
                  </g>
                )}

                {showLabel && (
                  <text
                    x={node.x}
                    y={node.y + node.radius + 12}
                    textAnchor="middle"
                    fontSize={node.type === "team" ? 10 : 8}
                    fill={isHovered || isDragging || isFocusAnchor ? "#e5e7eb" : "#94a3b8"}
                    fontWeight={node.type === "team" ? 600 : 500}
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      </div>

      <aside
        className="w-full xl:w-[300px] shrink-0 border-t xl:border-t-0 xl:border-l border-gray-800 bg-gray-950/75 p-2.5 max-h-[45vh] xl:max-h-none overflow-y-auto"
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-cyan-300/80">Focus Order</span>
              <span className="text-[10px] text-gray-500">
                {lockedFocusIds.length > 0 ? `${lockedFocusIds.length} locked` : "None"}
              </span>
            </div>

            {focusSequenceEntries.length > 0 ? (
              <ol className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {focusSequenceEntries.map((entry) => (
                  <li
                    key={`focus-order-${entry.nodeId}`}
                    className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
                      entry.isLatest
                        ? "border-cyan-700/40 bg-cyan-950/20"
                        : "border-gray-800 bg-gray-950/40"
                    }`}
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-700 text-[10px] text-gray-300">
                      {entry.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-gray-200">{entry.label}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">
                        {entry.type || "node"}
                        {entry.isLatest ? " • latest" : ""}
                      </p>
                    </div>
                    {!entry.isLatest && focusSequenceEntries.length > 1 && (
                      <button
                        type="button"
                        className="h-6 px-1.5 rounded border border-gray-700 text-[10px] text-gray-300 hover:bg-gray-800"
                        onClick={() => promoteFocusAnchor(entry.nodeId)}
                      >
                        Set Last
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-gray-500 leading-snug">
                Click nodes to lock focus. Sequence appears here as 1 → 2 → 3.
              </p>
            )}
          </div>

          <div className="border-t border-gray-800/90 pt-2">
            {detailNode ? (
              <div className="max-h-[min(360px,60vh)] overflow-y-auto space-y-1.5 text-[11px] pr-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-cyan-300/80">
                    {detailNode.type === "commit"
                      ? "Commit Detail"
                      : detailNode.type === "leak"
                        ? "Leak Detail"
                        : detailNode.type === "team"
                          ? "Team Detail"
                          : "Source Detail"}
                  </span>
                  <span className="text-[11px] text-gray-500 truncate max-w-[180px]">{detailNode.label}</span>
                </div>

                {detailCommit && (
                  <div className="space-y-1.5 text-[11px] text-gray-300">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded border border-cyan-600/40 text-cyan-300">{detailCommit.status}</span>
                      <span className="text-gray-500">{detailCommit.commit_type}</span>
                      {detailCommit.dri && <span className="text-gray-500">DRI: {detailCommit.dri}</span>}
                      {detailCommit.branch_name && <span className="text-gray-500 font-mono text-[10px]">{detailCommit.branch_name}</span>}
                    </div>

                    {detailCommit.summary && (
                      <p className="text-gray-300 leading-snug">{detailCommit.summary}</p>
                    )}

                    {detailCommit.rationale && (
                      <p className="text-gray-400 leading-snug">Rationale: {detailCommit.rationale}</p>
                    )}

                    {detailCommit.evidence_links?.length > 0 && (
                      <details className="group">
                        <summary className="text-[10px] uppercase tracking-wide text-gray-500 cursor-pointer select-none hover:text-gray-400">
                          Evidence Links ({detailCommit.evidence_links.length})
                        </summary>
                        <div className="mt-1.5 grid gap-1.5">
                          {detailCommit.evidence_links.map((link, index) => (
                            <EvidenceCard key={`detail-evidence-${detailCommit.id}-${index}`} link={link} />
                          ))}
                        </div>
                      </details>
                    )}

                    {detailCommitEdgeCounts.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {detailCommitEdgeCounts.map((edgeInfo) => (
                          <span
                            key={`edge-count-${detailCommit.id}-${edgeInfo.edge_type}`}
                            className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 text-[10px]"
                          >
                            {edgeInfo.edge_type}: {edgeInfo.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {detailLeak && (
                  <div className="space-y-1.5 text-[11px] text-gray-300">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded border border-red-600/40 text-red-300">Severity {detailLeak.severity}</span>
                      <span className="text-gray-500">{detailLeak.rule_key}</span>
                      <span className="text-gray-500">Team: {detailLeakTeamName}</span>
                      <span className="text-gray-500">Status: {detailLeak.status}</span>
                    </div>
                    <div className="h-1 rounded bg-gray-800 overflow-hidden">
                      <div
                        className="h-full bg-red-500"
                        style={{ width: `${clamp(detailLeak.severity, 0, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {detailTeam && (
                  <div className="space-y-1.5 text-[11px] text-gray-300">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded border border-gray-600/40 text-gray-300">{detailTeam.name}</span>
                      <span className="text-gray-500">Commits: {detailTeamCounts.commits}</span>
                      <span className="text-gray-500">Leaks: {detailTeamCounts.leaks}</span>
                    </div>
                    <p className="text-gray-500 leading-snug">
                      Lock this team last in multi-focus to expand through the team hub.
                    </p>
                  </div>
                )}

                {detailEntity && (
                  <div className="space-y-1.5 text-[11px] text-gray-300">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded border border-gray-600/40 text-gray-300 uppercase">
                        {detailEntity.provider}
                      </span>
                      <span className="text-gray-400">{detailEntity.entity_id}</span>
                      <span className="text-gray-500">Linked commits: {detailEntity.commit_ids.length}</span>
                      {detailEntity.entity_type && (
                        <span className="text-gray-500">Type: {detailEntity.entity_type}</span>
                      )}
                    </div>

                    {detailEntity.url && (
                      <EvidenceCard
                        link={{
                          url: detailEntity.url,
                          title: detailEntity.title || detailEntity.entity_id,
                          entity_id: detailEntity.entity_id,
                        }}
                      />
                    )}

                    {detailEntityTeamNames.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {detailEntityTeamNames.map((teamName) => (
                          <span key={`source-team-${detailEntity.entity_id}-${teamName}`} className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-400">
                            {teamName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 leading-snug">
                Hover a node to preview details, or lock focus to pin details and sequence.
              </p>
            )}
          </div>
        </div>
      </aside>
      </div>

      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block border border-gray-500 bg-gray-500/20" />
          Team
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full inline-block border border-cyan-400 bg-cyan-400/20" />
          Commit
        </span>
        <span className="flex items-center gap-1">
          <span className="w-0 h-0 inline-block border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent border-b-red-400" />
          Leak
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block border border-blue-400 bg-blue-400/20" style={{ clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%)" }} />
          Jira source
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 rounded-sm inline-block border border-fuchsia-400 bg-fuchsia-400/20" />
          Slack source
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block border border-emerald-400 bg-emerald-400/20" style={{ clipPath: "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)" }} />
          GitHub source
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-red-400 inline-block" />
          triggered by
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-dashed border-indigo-400 inline-block" />
          depends on
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-dashed border-amber-400 inline-block" />
          owned by team
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-dashed border-blue-400 inline-block" />
          linked evidence
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-dashed border-sky-400 inline-block" style={{ borderTopStyle: "dashed" }} />
          inferred (strong)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-amber-400 inline-block" style={{ borderTopStyle: "dotted" }} />
          inferred (medium)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-dashed border-cyan-400 inline-block" />
          cross-team link
        </span>
      </div>
    </div>
  );
}
