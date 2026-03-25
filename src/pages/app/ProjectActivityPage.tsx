import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  GitBranch,
  MessageSquare,
  Calendar,
  Link2,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ──────────────── Types ────────────────

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  start_date: string | null;
  target_date: string | null;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
  jira_project_keys: string[];
  github_repos: string[];
  slack_channel_ids: string[];
}

interface ActivityNode {
  id: string;
  type: "event" | "leak";
  source?: string;
  event_type?: string;
  leak_type?: string;
  severity?: string;
  summary: string;
  timestamp: string;
  external_id?: string;
}

interface ActivityEdge {
  id: string;
  source: string;
  target: string;
  source_type: string;
  target_type: string;
  link_type: string;
  confidence: number;
}

interface ActivityGraph {
  project_id: string;
  days: number;
  nodes: ActivityNode[];
  edges: ActivityEdge[];
  health_metrics: Record<string, number>;
  totals: { events: number; leaks: number; links: number };
}

// ──────────────── Helpers ────────────────

const sourceIcons: Record<string, typeof Activity> = {
  slack: MessageSquare,
  jira: Target,
  github: GitBranch,
};

const severityColors: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const statusColors: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/30",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  archived: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const DAYS_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

const metricLabels: Record<string, string> = {
  "jira.cycle_time_median": "Cycle Time",
  "github.pr_review_latency_median": "PR Review",
  "slack.unresolved_threads": "Unresolved Threads",
  "jira.reopen_rate": "Reopen Rate",
  "github.pr_age_median": "PR Age",
  "slack.thread_length_median": "Thread Length",
};

// ──────────────── Component ────────────────

export default function ProjectActivityPage() {
  const { id } = useParams<{ id: string }>();
  const [days, setDays] = useState("7");

  const { data: projectData, isLoading: projectLoading } = useQuery<{ project: ProjectDetail; stats: { events_7d: number; active_leaks: number } }>({
    queryKey: ["project", id],
    queryFn: () => apiFetch(`/api/projects/${id}`),
    enabled: !!id,
  });

  const { data: graphData, isLoading: graphLoading } = useQuery<ActivityGraph>({
    queryKey: ["project-activity", id, days],
    queryFn: () => apiFetch(`/api/projects/${id}/activity-graph?days=${days}`),
    enabled: !!id,
    refetchInterval: 120000,
  });

  const project = projectData?.project;

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading project...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <Link to="/app/projects" className="text-cyan-400 hover:underline text-sm flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Projects
        </Link>
        <div className="text-gray-400">Project not found.</div>
      </div>
    );
  }

  const leakNodes = graphData?.nodes.filter((n) => n.type === "leak") || [];
  const eventNodes = graphData?.nodes.filter((n) => n.type === "event") || [];

  // Group events by source for the connected tools display
  const eventsBySource: Record<string, ActivityNode[]> = {};
  for (const e of eventNodes) {
    const src = e.source || "unknown";
    if (!eventsBySource[src]) eventsBySource[src] = [];
    eventsBySource[src].push(e);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/app/projects" className="text-cyan-400 hover:underline text-xs flex items-center gap-1 mb-2">
            <ArrowLeft className="h-3 w-3" /> Projects
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-cyan-400" />
            {project.name}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            {project.team_name && (
              <span className="text-sm text-gray-400">
                Team: <span className="text-gray-300">{project.team_name}</span>
              </span>
            )}
            <Badge variant="outline" className={statusColors[project.status] || statusColors.active}>
              {project.status}
            </Badge>
            {project.target_date && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Target: {new Date(project.target_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <select
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          {DAYS_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Connected Tools */}
      <Card className="bg-gray-900/60 border-gray-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-cyan-400" />
            Connected Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-purple-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-300">Slack</p>
                {(project.slack_channel_ids?.length || 0) > 0 ? (
                  <p className="text-xs text-gray-500">
                    {project.slack_channel_ids.length} channel{project.slack_channel_ids.length !== 1 ? "s" : ""} linked
                  </p>
                ) : (
                  <p className="text-xs text-gray-600">No channels linked</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Target className="h-4 w-4 text-blue-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-300">Jira</p>
                {(project.jira_project_keys?.length || 0) > 0 ? (
                  <p className="text-xs text-gray-500">
                    {project.jira_project_keys.join(", ")}
                  </p>
                ) : (
                  <p className="text-xs text-gray-600">No projects linked</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <GitBranch className="h-4 w-4 text-green-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-300">GitHub</p>
                {(project.github_repos?.length || 0) > 0 ? (
                  <p className="text-xs text-gray-500">
                    {project.github_repos.join(", ")}
                  </p>
                ) : (
                  <p className="text-xs text-gray-600">No repos linked</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Health Snapshot + Activity Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-gray-900/60 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Health Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            {graphLoading ? (
              <div className="h-24 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
            ) : Object.keys(graphData?.health_metrics || {}).length === 0 ? (
              <div className="text-sm text-gray-500">No project-scoped metrics yet.</div>
            ) : (
              <div className="space-y-2">
                {Object.entries(graphData!.health_metrics).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{metricLabels[name] || name}</span>
                    <span className="text-gray-200 font-medium">{value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900/60 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {graphLoading ? (
              <div className="h-24 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-cyan-400">{graphData?.totals.events || 0}</p>
                  <p className="text-xs text-gray-500">Events</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-400">{graphData?.totals.leaks || 0}</p>
                  <p className="text-xs text-gray-500">Leaks</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-400">{graphData?.totals.links || 0}</p>
                  <p className="text-xs text-gray-500">Cross-tool Links</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Leaks */}
      {leakNodes.length > 0 && (
        <Card className="bg-gray-900/60 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Active Leaks ({leakNodes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {leakNodes.map((leak) => (
                <div
                  key={leak.id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                >
                  <Badge variant="outline" className={severityColors[leak.severity || "medium"] || severityColors.medium}>
                    {leak.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 capitalize">
                      {(leak.leak_type || "").replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{leak.summary}</p>
                  </div>
                  <span className="text-xs text-gray-600">
                    {new Date(leak.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity Timeline */}
      <Card className="bg-gray-900/60 border-gray-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {graphLoading ? (
            <div className="h-24 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
          ) : (graphData?.nodes.length || 0) === 0 ? (
            <div className="text-sm text-gray-500">No activity in the last {days} days.</div>
          ) : (
            <div className="space-y-1">
              {graphData!.nodes
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, 25)
                .map((node) => {
                  const Icon = node.type === "leak"
                    ? AlertTriangle
                    : sourceIcons[node.source || ""] || Activity;
                  const iconColor = node.type === "leak"
                    ? "text-red-400"
                    : node.source === "slack" ? "text-purple-400"
                    : node.source === "github" ? "text-green-400"
                    : node.source === "jira" ? "text-blue-400"
                    : "text-gray-400";

                  return (
                    <div key={node.id} className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-gray-800/30">
                      <Icon className={`h-4 w-4 mt-0.5 ${iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-300 truncate">{node.summary}</p>
                      </div>
                      <span className="text-xs text-gray-600 whitespace-nowrap">
                        {new Date(node.timestamp).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entity Links Graph placeholder */}
      {(graphData?.edges.length || 0) > 0 && (
        <Card className="bg-gray-900/60 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-purple-400" />
              Cross-Tool Connections ({graphData!.edges.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {graphData!.edges.slice(0, 20).map((edge) => (
                <div key={edge.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-gray-800/30">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {edge.source_type}
                  </Badge>
                  <span className="text-gray-500 truncate max-w-32">{edge.source}</span>
                  <span className="text-gray-600">→</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {edge.target_type}
                  </Badge>
                  <span className="text-gray-500 truncate max-w-32">{edge.target}</span>
                  <span className="text-gray-700 ml-auto">{(edge.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
