import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { GitCommit, Calendar, Network, SlidersHorizontal, X, ChevronDown, GitBranch, Tag, Hash } from "lucide-react";
import { useScope } from "@/hooks/useScope";
import { GitLedgerTree, type TreeCommit, type TreeTeam, type TreeLeak } from "@/components/git-ledger/GitLedgerTree";
import { ForceDirectedGraph } from "@/components/git-ledger/ForceDirectedGraph";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface TreeResponse {
  commits: TreeCommit[];
  teams: TreeTeam[];
  leaks: TreeLeak[];
  inferred_links?: Array<{
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
  }>;
  entities?: Array<{
    provider: "jira" | "slack" | "github";
    entity_type: string | null;
    entity_id: string;
    url: string | null;
    title: string | null;
    commit_ids: string[];
    team_ids: string[];
  }>;
  availableFilters?: {
    branches: string[];
    jira_keys: string[];
    github_prs: string[];
    slack_channels: string[];
    tags: string[];
  };
}

export default function LedgerPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("");
  const [jiraKeyFilter, setJiraKeyFilter] = useState("");
  const [prFilter, setPrFilter] = useState("");
  const [slackChannelFilter, setSlackChannelFilter] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const { scopeParams, teamId, projectId } = useScope();
  const hasInvalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const params = new URLSearchParams();
  if (typeFilter !== "all") params.set("commit_type", typeFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (branchFilter) params.set("branch", branchFilter);
  if (jiraKeyFilter) params.set("jira_key", jiraKeyFilter);
  if (prFilter) params.set("pr", prFilter);
  if (slackChannelFilter) params.set("slack_channel", slackChannelFilter);
  if (tagFilters.length > 0) params.set("tags", tagFilters.join(","));
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  if (scopeParams) {
    for (const part of scopeParams.split("&")) {
      const [k, v] = part.split("=");
      if (k && v) params.set(k, v);
    }
  }

  const graphScopeParams = new URLSearchParams();
  if (scopeParams) {
    for (const part of scopeParams.split("&")) {
      const [k, v] = part.split("=");
      if (k && v) graphScopeParams.set(k, v);
    }
  }

  const { data, isLoading } = useQuery<TreeResponse>({
    queryKey: [
      "ledger-tree",
      typeFilter,
      statusFilter,
      branchFilter,
      jiraKeyFilter,
      prFilter,
      slackChannelFilter,
      tagFilters.join("|"),
      dateFrom,
      dateTo,
      scopeParams,
    ],
    queryFn: () => apiFetch(`/api/ledger/tree?${params.toString()}`),
    enabled: !hasInvalidDateRange,
    refetchInterval: hasInvalidDateRange ? false : 30000,
  });

  const { data: graphData } = useQuery<TreeResponse>({
    queryKey: ["ledger-tree-graph-base", scopeParams],
    queryFn: () => {
      const query = graphScopeParams.toString();
      return apiFetch(`/api/ledger/tree${query ? `?${query}` : ""}`);
    },
    enabled: viewMode === "graph",
    refetchInterval: 30000,
  });

  const filteredCommits = hasInvalidDateRange ? [] : data?.commits || [];
  const filteredTeams = hasInvalidDateRange ? [] : data?.teams || [];
  const filteredLeaks = hasInvalidDateRange ? [] : data?.leaks || [];

  const graphCommits = hasInvalidDateRange ? [] : graphData?.commits || filteredCommits;
  const graphTeams = hasInvalidDateRange ? [] : graphData?.teams || filteredTeams;
  const graphLeaks = hasInvalidDateRange ? [] : graphData?.leaks || filteredLeaks;
  const graphEntities = hasInvalidDateRange ? [] : graphData?.entities || [];
  const graphInferredLinks = hasInvalidDateRange ? [] : graphData?.inferred_links || [];

  const activeCommits = viewMode === "graph" ? graphCommits : filteredCommits;
  const activeLeaks = viewMode === "graph" ? graphLeaks : filteredLeaks;

  const availableFiltersSource = graphData || data;
  const availableFilters = availableFiltersSource?.availableFilters || {
    branches: [],
    jira_keys: [],
    github_prs: [],
    slack_channels: [],
    tags: [],
  };

  const hasActiveGraphFilters = Boolean(
    typeFilter !== "all"
      || statusFilter !== "all"
      || branchFilter
      || jiraKeyFilter
      || prFilter
      || slackChannelFilter
      || tagFilters.length > 0
      || dateFrom
      || dateTo,
  );

  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount = [
    typeFilter !== "all",
    statusFilter !== "all",
    branchFilter,
    jiraKeyFilter,
    prFilter,
    slackChannelFilter,
    tagFilters.length > 0,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setBranchFilter("");
    setJiraKeyFilter("");
    setPrFilter("");
    setSlackChannelFilter("");
    setTagFilters([]);
    setDateFrom("");
    setDateTo("");
  };

  const selectClasses = "h-8 bg-gray-900/80 border border-gray-700/60 rounded-md px-2.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-colors hover:border-gray-600";

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <GitCommit className="h-4.5 w-4.5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Git Ledger</h1>
            <p className="text-gray-500 text-xs leading-tight">Version control for decisions</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 bg-gray-900/50 border border-gray-800 rounded-full px-3 py-1">
            {viewMode === "graph" && hasActiveGraphFilters ? (
              <>
                <span className="text-cyan-400 font-medium">{filteredCommits.length}</span>
                <span>/</span>
                <span>{graphCommits.length} commits</span>
                <span className="text-gray-700 mx-0.5">·</span>
                <span className="text-amber-400 font-medium">{filteredLeaks.length}</span>
                <span>/</span>
                <span>{graphLeaks.length} leaks</span>
              </>
            ) : (
              <>
                <span className="text-cyan-400 font-medium">{activeCommits.length}</span>
                <span>commits</span>
                <span className="text-gray-700 mx-0.5">·</span>
                <span className="text-amber-400 font-medium">{activeLeaks.length}</span>
                <span>leaks</span>
              </>
            )}
          </div>

          {/* View mode toggle (buttons styled as segmented control) */}
          <div className="flex h-8 rounded-md bg-gray-900/80 border border-gray-800 p-0.5 gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-3 text-xs rounded-[5px] ${
                viewMode === "tree"
                  ? "bg-cyan-600 text-white hover:bg-cyan-600 shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
              onClick={() => setViewMode("tree")}
            >
              <GitCommit className="h-3 w-3 mr-1.5" />
              Tree
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-3 text-xs rounded-[5px] ${
                viewMode === "graph"
                  ? "bg-cyan-600 text-white hover:bg-cyan-600 shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
              onClick={() => setViewMode("graph")}
            >
              <Network className="h-3 w-3 mr-1.5" />
              Graph
            </Button>
          </div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick type filter — always visible */}
          <select className={selectClasses} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option>
            <option value="decision">Decisions</option>
            <option value="action">Actions</option>
            <option value="policy">Policies</option>
            <option value="template_change">Template Changes</option>
          </select>
          <select className={selectClasses} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="proposed">Proposed</option>
            <option value="approved">Approved</option>
            <option value="merged">Merged</option>
            <option value="rejected">Rejected</option>
          </select>

          {/* More filters toggle */}
          <button
            type="button"
            className="h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-gray-700/60 bg-gray-900/50 text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 text-xs transition-colors"
            onClick={() => setFiltersOpen((prev) => !prev)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            More
            {activeFilterCount > 2 && (
              <Badge className="ml-0.5 h-4 min-w-4 px-1 text-[10px] bg-cyan-500/20 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20">
                {activeFilterCount - [typeFilter !== "all", statusFilter !== "all"].filter(Boolean).length}
              </Badge>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`} />
          </button>

          {/* Active filter pills */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {typeFilter !== "all" && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-cyan-600/30 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-950/30 cursor-pointer" onClick={() => setTypeFilter("all")}>
                  {typeFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {statusFilter !== "all" && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-emerald-600/30 text-emerald-300 bg-emerald-950/20 hover:bg-emerald-950/30 cursor-pointer" onClick={() => setStatusFilter("all")}>
                  {statusFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {branchFilter && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-purple-600/30 text-purple-300 bg-purple-950/20 hover:bg-purple-950/30 cursor-pointer" onClick={() => setBranchFilter("")}>
                  <GitBranch className="h-2.5 w-2.5" />
                  {branchFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {jiraKeyFilter && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-blue-600/30 text-blue-300 bg-blue-950/20 hover:bg-blue-950/30 cursor-pointer" onClick={() => setJiraKeyFilter("")}>
                  {jiraKeyFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {prFilter && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-orange-600/30 text-orange-300 bg-orange-950/20 hover:bg-orange-950/30 cursor-pointer" onClick={() => setPrFilter("")}>
                  <Hash className="h-2.5 w-2.5" />
                  {prFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {slackChannelFilter && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-fuchsia-600/30 text-fuchsia-300 bg-fuchsia-950/20 hover:bg-fuchsia-950/30 cursor-pointer" onClick={() => setSlackChannelFilter("")}>
                  {slackChannelFilter}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {tagFilters.map((tag) => (
                <Badge key={tag} variant="outline" className="h-6 gap-1 text-[11px] border-amber-600/30 text-amber-300 bg-amber-950/20 hover:bg-amber-950/30 cursor-pointer" onClick={() => setTagFilters((prev) => prev.filter((t) => t !== tag))}>
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              ))}
              {(dateFrom || dateTo) && (
                <Badge variant="outline" className="h-6 gap-1 text-[11px] border-gray-600/30 text-gray-300 bg-gray-800/40 hover:bg-gray-800/60 cursor-pointer" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                  <Calendar className="h-2.5 w-2.5" />
                  {dateFrom || "..."} → {dateTo || "..."}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {activeFilterCount > 1 && (
                <button
                  className="text-[11px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800/50 transition-colors"
                  onClick={clearAllFilters}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Expanded filter panel */}
        {filtersOpen && (
          <div className="rounded-lg border border-gray-800/60 bg-gray-900/30 p-3 animate-in slide-in-from-top-1 duration-150">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2.5">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Sources</span>
              <div className="flex items-center gap-2 flex-wrap">
                <select className={selectClasses} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                  <option value="">All Branches</option>
                  {availableFilters.branches.map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
                <select className={selectClasses} value={jiraKeyFilter} onChange={(e) => setJiraKeyFilter(e.target.value)}>
                  <option value="">All Jira Keys</option>
                  {availableFilters.jira_keys.map((jiraKey) => (
                    <option key={jiraKey} value={jiraKey}>{jiraKey}</option>
                  ))}
                </select>
                <select className={selectClasses} value={prFilter} onChange={(e) => setPrFilter(e.target.value)}>
                  <option value="">All GitHub PRs</option>
                  {availableFilters.github_prs.map((pr) => (
                    <option key={pr} value={pr}>{pr}</option>
                  ))}
                </select>
                <select className={selectClasses} value={slackChannelFilter} onChange={(e) => setSlackChannelFilter(e.target.value)}>
                  <option value="">All Slack Channels</option>
                  {availableFilters.slack_channels.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </div>

              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Tags</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {availableFilters.tags.length > 0 ? (
                  availableFilters.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`h-6 px-2.5 rounded-full text-[11px] border transition-colors ${
                        tagFilters.includes(tag)
                          ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                          : "border-gray-700/60 bg-gray-900/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                      }`}
                      onClick={() =>
                        setTagFilters((prev) =>
                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                        )
                      }
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <span className="text-[11px] text-gray-600 italic">No tags available</span>
                )}
              </div>

              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Dates</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    className={`h-8 bg-gray-900/80 border rounded-md px-2 text-xs text-gray-300 focus:outline-none focus:ring-1 transition-colors ${
                      hasInvalidDateRange
                        ? "border-red-500/60 focus:ring-red-500/50"
                        : "border-gray-700/60 focus:ring-cyan-500/50 hover:border-gray-600"
                    }`}
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                  <span className="text-gray-600 text-xs">→</span>
                  <input
                    type="date"
                    className={`h-8 bg-gray-900/80 border rounded-md px-2 text-xs text-gray-300 focus:outline-none focus:ring-1 transition-colors ${
                      hasInvalidDateRange
                        ? "border-red-500/60 focus:ring-red-500/50"
                        : "border-gray-700/60 focus:ring-cyan-500/50 hover:border-gray-600"
                    }`}
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                {hasInvalidDateRange && (
                  <span className="text-[11px] text-red-400">From date must be before To date</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Contextual tip ── */}
      <p className="text-[11px] text-gray-600 leading-relaxed">
        {viewMode === "tree"
          ? "Click a leak in the LEAKS lane to trace its impact across teams."
          : "Hover to preview, click to focus, drag to rearrange. Shapes: ● commit  ▲ leak  ■ team  ⬡ Jira  ▢ Slack  ⬣ GitHub"}
      </p>

      {/* ── Content ── */}
      {viewMode === "tree" ? (
        <GitLedgerTree
          commits={filteredCommits}
          teams={filteredTeams}
          leaks={filteredLeaks}
          isLoading={isLoading}
        />
      ) : (
        <ForceDirectedGraph
          commits={graphCommits}
          teams={graphTeams}
          leaks={graphLeaks}
          entities={graphEntities}
          inferredLinks={graphInferredLinks}
          teamId={teamId}
          projectId={projectId}
          filterState={{
            typeFilter,
            statusFilter,
            branchFilter,
            jiraKeyFilter,
            prFilter,
            slackChannelFilter,
            tagFilters,
            dateFrom,
            dateTo,
          }}
        />
      )}
    </div>
  );
}
