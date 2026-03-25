import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  GitCommit, GitMerge, GitFork, AlertTriangle, ChevronDown, ChevronRight,
  Building2, Users, ShieldAlert, CheckCircle2, Clock, XCircle,
  ArrowUpFromLine, CircleHelp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EvidenceCard } from "@/components/EvidenceCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

interface TreeEdge {
  id: string;
  edge_type: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  target_data: Record<string, unknown> | null;
}

export interface TreeCommit {
  id: string;
  commit_type: string;
  title: string;
  summary: string;
  rationale: string | null;
  dri: string | null;
  status: string;
  branch_name: string;
  parent_commit_id: string | null;
  team_id: string | null;
  project_id: string | null;
  scope_level: string | null;
  promoted_from: string | null;
  evidence_links: Array<{ url: string; title?: string }>;
  tags: string[];
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  edges: TreeEdge[];
}

export interface TreeTeam {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
}

export interface TreeLeak {
  id: string;
  rule_key: string;
  title: string;
  severity: number;
  team_id: string | null;
  created_at: string;
  status: string;
}

interface Lane {
  id: string;
  type: "org" | "team" | "leaks";
  name: string;
  color: string;
  items: Array<TreeCommit | TreeLeak>;
}

interface GitLedgerTreeProps {
  commits: TreeCommit[];
  teams: TreeTeam[];
  leaks: TreeLeak[];
  isLoading?: boolean;
}

// ============================================
// Style config
// ============================================

const commitTypeConfig: Record<string, { color: string; icon: string; badge: string }> = {
  decision:        { color: "text-cyan-400",   icon: "📋", badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  action:          { color: "text-green-400",  icon: "⚡", badge: "bg-green-500/15 text-green-400 border-green-500/30" },
  policy:          { color: "text-purple-400", icon: "📜", badge: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  template_change: { color: "text-amber-400",  icon: "📝", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  rollback:        { color: "text-red-400",    icon: "↩️", badge: "bg-red-500/15 text-red-400 border-red-500/30" },
  override:        { color: "text-amber-400",  icon: "⚠️", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
};

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  draft:    { color: "text-gray-400",   icon: Clock },
  proposed: { color: "text-yellow-400", icon: Clock },
  approved: { color: "text-blue-400",   icon: CheckCircle2 },
  merged:   { color: "text-green-400",  icon: CheckCircle2 },
  rejected: { color: "text-red-400",    icon: XCircle },
};

const commitTypeDescriptions: Record<string, string> = {
  decision: "Rationale-level record of why something was decided.",
  action: "Executable step taken to implement a decision.",
  policy: "Org-wide rule or standard applied across teams.",
  template_change: "Modification to a reusable operational template.",
  rollback: "Reversal of a previous commit.",
  override: "Exception to an existing policy or decision.",
};

const statusDescriptions: Record<string, string> = {
  draft: "Work in progress. Not submitted for review yet.",
  proposed: "Submitted for review and awaiting approval.",
  approved: "Accepted by reviewer/approver and ready to merge.",
  merged: "Integrated into mainline operational history.",
  rejected: "Reviewed and not accepted.",
};

const DEFAULT_TEAM_COLOR = "#6b7280";

// ============================================
// Main component
// ============================================

export function GitLedgerTree({ commits, teams, leaks, isLoading }: GitLedgerTreeProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [traceLeakId, setTraceLeakId] = useState<string | null>(null);

  // Build lanes: ORG | team… | LEAKS
  const lanes = useMemo<Lane[]>(() => {
    const orgCommits = commits.filter(
      (c) => c.scope_level === "org" || (!c.team_id && !c.scope_level),
    );

    const teamLanes: Lane[] = teams
      .map((team) => ({
        id: team.id,
        type: "team" as const,
        name: team.name,
        color: team.color || DEFAULT_TEAM_COLOR,
        items: commits.filter(
          (c) => c.team_id === team.id && c.scope_level !== "org",
        ) as Array<TreeCommit | TreeLeak>,
      }))
      .filter((l) => l.items.length > 0);

    return [
      {
        id: "org",
        type: "org" as const,
        name: "ORG",
        color: "#06b6d4",
        items: orgCommits as Array<TreeCommit | TreeLeak>,
      },
      ...teamLanes,
      {
        id: "leaks",
        type: "leaks" as const,
        name: "LEAKS",
        color: "#ef4444",
        items: leaks as Array<TreeCommit | TreeLeak>,
      },
    ];
  }, [commits, teams, leaks]);

  // IDs connected to the traced leak (for highlight / fade)
  const tracedCommitIds = useMemo(() => {
    if (!traceLeakId) return new Set<string>();
    const ids = new Set<string>();
    for (const commit of commits) {
      const triggered = commit.edges?.some(
        (e) =>
          e.edge_type === "triggered_by" &&
          e.target_type === "leak_instance" &&
          e.target_id === traceLeakId,
      );
      if (triggered) {
        ids.add(commit.id);
        // also include children that depend on this commit
        for (const c2 of commits) {
          if (
            c2.edges?.some(
              (e) =>
                e.edge_type === "depends_on" &&
                e.target_type === "ledger_commit" &&
                e.target_id === commit.id,
            )
          )
            ids.add(c2.id);
        }
      }
    }
    return ids;
  }, [traceLeakId, commits]);

  // Compute fork map: leakId → set of team IDs that responded
  const forkMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const commit of commits) {
      const leakEdges = commit.edges?.filter(
        (e) => e.edge_type === "triggered_by" && e.target_type === "leak_instance",
      ) || [];
      for (const edge of leakEdges) {
        if (commit.team_id) {
          if (!map.has(edge.target_id)) map.set(edge.target_id, new Set());
          map.get(edge.target_id)!.add(commit.team_id);
        }
      }
    }
    return map;
  }, [commits]);

  const laneMinWidth = lanes.length >= 5 ? 180 : 220;

  if (isLoading) return <TreeSkeleton laneCount={lanes.length || 3} />;
  if (commits.length === 0 && leaks.length === 0) return <TreeEmpty />;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="overflow-x-auto">
        <div className="flex items-center justify-between px-1 pb-2 text-[11px] text-gray-500">
          <span>Expand any commit for full context and evidence links.</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 hover:border-gray-600"
                aria-label="Git ledger card guide"
              >
                <CircleHelp className="h-3 w-3" />
                Card guide
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <p className="font-medium mb-1">Card Anatomy</p>
              <p className="text-gray-300">Type badge | Status badge | DRI | Branch | Summary | Rationale | Evidence</p>
              <p className="mt-2 text-gray-400">Workflow: draft → proposed → approved → merged (or rejected).</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className="grid gap-3 min-w-max"
          style={{
            gridTemplateColumns: `repeat(${lanes.length}, minmax(${laneMinWidth}px, 1fr))`,
          }}
        >
          {/* Lane headers */}
          {lanes.map((lane) => (
            <LaneHeader key={lane.id} lane={lane} />
          ))}

          {/* Lane columns */}
          {lanes.map((lane) => (
            <LaneColumn
              key={lane.id}
              lane={lane}
              expandedId={expandedId}
              onToggleExpand={(id) =>
                setExpandedId(expandedId === id ? null : id)
              }
              traceLeakId={traceLeakId}
              onTraceLeak={(id) =>
                setTraceLeakId(traceLeakId === id ? null : id)
              }
              tracedCommitIds={tracedCommitIds}
              forkMap={forkMap}
              teams={teams}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ============================================
// Lane header
// ============================================

function LaneHeader({ lane }: { lane: Lane }) {
  const Icon =
    lane.type === "org"
      ? Building2
      : lane.type === "leaks"
        ? ShieldAlert
        : Users;

  return (
    <div className="sticky top-0 z-10 bg-gray-950/90 backdrop-blur-sm pb-2 border-b border-gray-800">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon className="h-4 w-4" style={{ color: lane.color }} />
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: lane.color }}
        >
          {lane.name}
        </span>
        <span className="text-xs text-gray-600 ml-auto">
          {lane.items.length}
        </span>
      </div>
    </div>
  );
}

function commitDependsOnTarget(commit: TreeCommit, targetCommitId: string): boolean {
  if (commit.parent_commit_id === targetCommitId) {
    return true;
  }
  return Boolean(
    commit.edges?.some(
      (edge) =>
        edge.edge_type === "depends_on" &&
        edge.target_type === "ledger_commit" &&
        edge.target_id === targetCommitId,
    ),
  );
}

function areAdjacentLaneCommitsConnected(a: TreeCommit, b: TreeCommit): boolean {
  return commitDependsOnTarget(a, b.id) || commitDependsOnTarget(b, a.id);
}

// ============================================
// Lane column
// ============================================

function LaneColumn({
  lane,
  expandedId,
  onToggleExpand,
  traceLeakId,
  onTraceLeak,
  tracedCommitIds,
  forkMap,
  teams,
}: {
  lane: Lane;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  traceLeakId: string | null;
  onTraceLeak: (id: string) => void;
  tracedCommitIds: Set<string>;
  forkMap: Map<string, Set<string>>;
  teams: TreeTeam[];
}) {
  if (lane.items.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-700 text-xs py-8">
        No items
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="space-y-1 py-1">
        {lane.type === "leaks"
          ? lane.items.map((item) => (
            <LeakNode
              key={item.id}
              leak={item as TreeLeak}
              isTraced={traceLeakId === item.id}
              onTrace={onTraceLeak}
              forkTeamIds={forkMap.get(item.id)}
              teams={teams}
            />
          ))
          : (lane.items as TreeCommit[]).map((item, index, laneCommits) => {
            const previous = index > 0 ? laneCommits[index - 1] : null;
            const next = index < laneCommits.length - 1 ? laneCommits[index + 1] : null;
            return (
            <CommitNode
              key={item.id}
              commit={item}
              laneColor={lane.color}
              isExpanded={expandedId === item.id}
              onToggleExpand={onToggleExpand}
              isFaded={!!traceLeakId && !tracedCommitIds.has(item.id)}
              isHighlighted={tracedCommitIds.has(item.id)}
              hasParentConnection={Boolean(previous && areAdjacentLaneCommitsConnected(item, previous))}
              hasChildConnection={Boolean(next && areAdjacentLaneCommitsConnected(item, next))}
            />
            );
          })}
      </div>
    </div>
  );
}

// ============================================
// Commit node (collapsed = oneline, expanded = full card)
// ============================================

function CommitNode({
  commit,
  laneColor,
  isExpanded,
  onToggleExpand,
  isFaded,
  isHighlighted,
  hasParentConnection,
  hasChildConnection,
}: {
  commit: TreeCommit;
  laneColor: string;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  isFaded: boolean;
  isHighlighted: boolean;
  hasParentConnection: boolean;
  hasChildConnection: boolean;
}) {
  const config = commitTypeConfig[commit.commit_type] || commitTypeConfig.decision;
  const StatusIcon = statusConfig[commit.status]?.icon || Clock;

  const triggeredByLeaks =
    commit.edges?.filter(
      (e) => e.edge_type === "triggered_by" && e.target_type === "leak_instance",
    ) || [];

  return (
    <div
      className={cn(
        "relative pl-8 transition-all duration-200 cursor-pointer group",
        isFaded && "opacity-30",
        isHighlighted && "opacity-100",
      )}
      onClick={() => onToggleExpand(commit.id)}
    >
      {hasParentConnection && (
        <div
          className="absolute left-[7px] top-0 h-2.5 w-px opacity-35"
          style={{ backgroundColor: laneColor }}
        />
      )}
      {hasChildConnection && (
        <div
          className="absolute left-[7px] top-[13px] bottom-0 w-px opacity-35"
          style={{ backgroundColor: laneColor }}
        />
      )}

      {/* Branch dot */}
      <div
        className={cn(
          "absolute left-2 top-2.5 w-3 h-3 rounded-full border-2 z-10",
          isHighlighted && "ring-2 ring-offset-1 ring-offset-gray-950",
        )}
        style={{
          backgroundColor: isExpanded ? laneColor : "transparent",
          borderColor: laneColor,
        }}
      />

      {/* Merge indicator */}
      {commit.promoted_from && (
        <GitMerge
          className="absolute left-0 top-2.5 h-3 w-3 text-cyan-400"
        />
      )}

      {/* Oneline: hash + icon + title + status */}
      <div className="flex items-center gap-1.5 min-h-[28px]">
        <code className="text-[10px] font-mono text-gray-600 shrink-0">
          {commit.id.substring(0, 7)}
        </code>
        <span className="text-xs">{config.icon}</span>
        <span
          className={cn(
            "text-xs truncate flex-1",
            config.color,
            commit.status === "merged" ? "font-medium" : "font-normal",
          )}
        >
          {commit.title}
        </span>
        <StatusIcon
          className={cn(
            "h-3 w-3 shrink-0",
            statusConfig[commit.status]?.color || "text-gray-500",
          )}
        />
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-gray-600 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-600 shrink-0 opacity-0 group-hover:opacity-100" />
        )}
      </div>

      {/* Collapsed meta */}
      {!isExpanded && triggeredByLeaks.length > 0 && (
        <div className="flex items-center gap-1 ml-1 mt-0.5">
          <span className="text-[10px] text-red-400/70">
            ← {(triggeredByLeaks[0].target_data as Record<string, string> | null)?.rule_key || "leak"}
          </span>
        </div>
      )}
      {!isExpanded && commit.dri && (
        <div className="text-[10px] text-gray-600 ml-1">
          DRI: {commit.dri}
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && <CommitDetail commit={commit} />}
    </div>
  );
}

// ============================================
// Expanded commit detail card
// ============================================

function CommitDetail({ commit }: { commit: TreeCommit }) {
  const triggeredBy = commit.edges?.filter((e) => e.edge_type === "triggered_by") || [];
  const references  = commit.edges?.filter((e) => e.edge_type === "references") || [];
  const resultedIn  = commit.edges?.filter((e) => e.edge_type === "resulted_in") || [];
  const dependsOn   = commit.edges?.filter(
    (e) => e.edge_type === "depends_on" && e.target_type === "ledger_commit",
  ) || [];

  return (
    <div
      className="mt-2 p-3 rounded-md bg-gray-900/80 border border-gray-800 text-xs space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={commitTypeConfig[commit.commit_type]?.badge}
              variant="outline"
            >
              {commit.commit_type}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            {commitTypeDescriptions[commit.commit_type] || "Commit classification."}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={cn(
                "border",
                commit.status === "merged"
                  ? "bg-green-500/15 text-green-400 border-green-500/30"
                  : commit.status === "approved"
                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                    : commit.status === "rejected"
                      ? "bg-red-500/15 text-red-400 border-red-500/30"
                      : "bg-gray-500/15 text-gray-400 border-gray-500/30",
              )}
              variant="outline"
            >
              {commit.status}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            {statusDescriptions[commit.status] || "Commit lifecycle status."}
          </TooltipContent>
        </Tooltip>
        {commit.dri && (
          <span className="text-gray-400">
            DRI: <span className="text-gray-300">{commit.dri}</span>
          </span>
        )}
        {commit.branch_name && (
          <span className="text-gray-500 ml-auto font-mono">
            {commit.branch_name}
          </span>
        )}
      </div>

      {/* Summary */}
      {commit.summary && (
        <div>
          <p className="text-gray-500 font-medium mb-0.5">SUMMARY</p>
          <p className="text-gray-300">{commit.summary}</p>
        </div>
      )}

      {/* Rationale */}
      {commit.rationale && (
        <div>
          <p className="text-gray-500 font-medium mb-0.5">RATIONALE</p>
          <p className="text-gray-300">{commit.rationale}</p>
        </div>
      )}

      {/* Edge sections */}
      {triggeredBy.length > 0 && (
        <EdgeSection title="TRIGGERED BY" edges={triggeredBy} />
      )}
      {references.length > 0 && (
        <EdgeSection title="EVIDENCE" edges={references} />
      )}
      {resultedIn.length > 0 && (
        <EdgeSection title="RESULTED IN" edges={resultedIn} />
      )}
      {dependsOn.length > 0 && (
        <EdgeSection title="CONNECTED DECISIONS" edges={dependsOn} />
      )}

      {/* Legacy evidence links */}
      {commit.evidence_links?.length > 0 && (
        <div>
          <p className="text-gray-500 font-medium mb-1">EVIDENCE LINKS</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {commit.evidence_links.map((link, i) => (
              <EvidenceCard key={`${commit.id}-evidence-${i}`} link={link} />
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {commit.tags?.length > 0 && (
        <div className="flex gap-1 flex-wrap pt-1 border-t border-gray-800">
          {commit.tags.map((tag) => (
            <Badge
              key={tag}
              className="bg-gray-800/50 text-gray-500 border-gray-700/50"
              variant="outline"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-gray-600 pt-1 border-t border-gray-800">
        <span>
          {new Date(commit.created_at).toLocaleString()}
          {commit.approved_by && ` · Approved by ${commit.approved_by}`}
        </span>
        {commit.scope_level === "team" &&
         (commit.status === "merged" || commit.status === "approved") && (
          <PromoteButton commitId={commit.id} />
        )}
      </div>
    </div>
  );
}

// ============================================
// Promote to Org button
// ============================================

function PromoteButton({ commitId }: { commitId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ledger/${commitId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger-tree"] });
    },
  });

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate();
      }}
      disabled={mutation.isPending || mutation.isSuccess}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
        mutation.isSuccess
          ? "bg-green-500/15 text-green-400"
          : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20",
      )}
    >
      <ArrowUpFromLine className="h-3 w-3" />
      {mutation.isPending ? "Promoting..." : mutation.isSuccess ? "Promoted ✓" : "Promote to Org"}
    </button>
  );
}

// ============================================
// Edge section + card
// ============================================

function EdgeSection({ title, edges }: { title: string; edges: TreeEdge[] }) {
  return (
    <div>
      <p className="text-gray-500 font-medium mb-1">{title}</p>
      {edges.map((edge) => (
        <EdgeCard key={edge.id} edge={edge} />
      ))}
    </div>
  );
}

function EdgeCard({ edge }: { edge: TreeEdge }) {
  const data = edge.target_data as Record<string, string | number | undefined> | null;

  const typeIcons: Record<string, string> = {
    leak_instance: "🔴",
    event: "💬",
    proposed_action: "⚡",
    ledger_commit: "📋",
  };
  const icon = typeIcons[edge.target_type] || "🔗";

  let label = edge.target_type;
  let detail = edge.target_id.substring(0, 8);

  if (data) {
    if (edge.target_type === "leak_instance") {
      label = String(data.rule_key || data.title || "Leak");
      detail = `severity: ${data.severity ?? "?"}`;
    } else if (edge.target_type === "event") {
      label = String(data.source || "Event");
      const content = data.title || data.content;
      detail = content ? String(content).substring(0, 60) : "";
    } else if (edge.target_type === "proposed_action") {
      label = String(data.title || data.action_type || "Action");
      detail =
        data.status === "executed"
          ? "✅ executed"
          : data.status === "pending"
            ? "⏳ pending"
            : String(data.status || "");
    } else if (edge.target_type === "ledger_commit") {
      label = String(data.title || "Commit");
      detail = String(data.status || "");
    }
  }

  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded bg-gray-800/50 mb-1">
      <span className="text-xs mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-gray-300 truncate">{label}</p>
        {detail && <p className="text-gray-500 truncate">{detail}</p>}
      </div>
    </div>
  );
}

// ============================================
// Leak node in LEAKS lane
// ============================================

function LeakNode({
  leak,
  isTraced,
  onTrace,
  forkTeamIds,
  teams,
}: {
  leak: TreeLeak;
  isTraced: boolean;
  onTrace: (id: string) => void;
  forkTeamIds?: Set<string>;
  teams: TreeTeam[];
}) {
  const severityColor =
    leak.severity >= 70
      ? "text-red-400"
      : leak.severity >= 40
        ? "text-amber-400"
        : "text-yellow-400";
  const dotColor =
    leak.severity >= 70
      ? "bg-red-500"
      : leak.severity >= 40
        ? "bg-amber-500"
        : "bg-yellow-500";

  const isFork = forkTeamIds && forkTeamIds.size > 1;
  const forkTeams = isFork
    ? teams.filter((t) => forkTeamIds.has(t.id))
    : [];

  return (
    <div
      className={cn(
        "relative pl-8 cursor-pointer group transition-all duration-200",
        isTraced && "ring-1 ring-red-500/30 rounded bg-red-500/5",
      )}
      onClick={() => onTrace(leak.id)}
    >
      <div
        className={cn(
          "absolute left-2 top-2 w-3 h-3 rounded-full",
          dotColor,
          isTraced && "ring-2 ring-red-400 ring-offset-1 ring-offset-gray-950",
        )}
      />

      <div className="flex items-center gap-1.5 min-h-[28px]">
        <span className={cn("text-xs font-mono", severityColor)}>
          {leak.severity}
        </span>
        <span className={cn("text-xs truncate flex-1", severityColor)}>
          {leak.rule_key}
        </span>
        {isFork ? (
          <GitFork className={cn("h-3 w-3 shrink-0 text-cyan-400")} />
        ) : (
          <AlertTriangle className={cn("h-3 w-3 shrink-0", severityColor)} />
        )}
      </div>
      {leak.title && (
        <p className="text-[10px] text-gray-500 truncate ml-1">
          {leak.title}
        </p>
      )}
      {/* Fork indicator: show which teams responded */}
      {isFork && (
        <div className="flex items-center gap-1 ml-1 mt-0.5 flex-wrap">
          <GitFork className="h-2.5 w-2.5 text-cyan-400/60" />
          {forkTeams.map((t) => (
            <span
              key={t.id}
              className="text-[9px] px-1 rounded border"
              style={{
                color: t.color || DEFAULT_TEAM_COLOR,
                borderColor: `${t.color || DEFAULT_TEAM_COLOR}40`,
                backgroundColor: `${t.color || DEFAULT_TEAM_COLOR}10`,
              }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      {!isFork && forkTeamIds && forkTeamIds.size === 1 && (
        <p className="text-[10px] text-gray-600 ml-1">
          1 team responded
        </p>
      )}
      <p className="text-[10px] text-gray-600 ml-1">
        {new Date(leak.created_at).toLocaleDateString()}
      </p>
      {isTraced && (
        <p className="text-[10px] text-red-400/70 ml-1 mt-0.5">
          Click again to clear trace
        </p>
      )}
    </div>
  );
}

// ============================================
// Skeleton / empty
// ============================================

function TreeSkeleton({ laneCount }: { laneCount: number }) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${laneCount}, minmax(200px, 1fr))`,
      }}
    >
      {Array.from({ length: laneCount }).map((_, i) => (
        <div key={i}>
          <div className="h-6 bg-gray-800/50 rounded animate-pulse mb-3" />
          {Array.from({ length: 3 }).map((_, j) => (
            <div
              key={j}
              className="h-10 bg-gray-800/30 rounded animate-pulse mb-2"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TreeEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <GitCommit className="h-12 w-12 mb-3 opacity-30" />
      <p className="text-sm mb-1">No ledger commits yet</p>
      <p className="text-xs text-gray-600">
        Commits will appear here as decisions are captured
      </p>
    </div>
  );
}
