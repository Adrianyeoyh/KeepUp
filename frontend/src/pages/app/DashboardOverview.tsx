import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  LayoutDashboard,
  AlertTriangle,
  GitCommit,
  CheckSquare,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useScope } from "@/hooks/useScope";

// ──────────────── Types ────────────────

interface DashboardData {
  company: { id: string; name: string; settings: Record<string, unknown> } | null;
  leaks: { total: number; by_status: Record<string, number> };
  events: { total: number; by_source: Record<string, number> };
  recent_leaks: Array<{
    id: string;
    leak_type: string;
    severity: number;
    confidence: number;
    status: string;
    detected_at: string;
    cost_estimate_hours_per_week: number | null;
    evidence_links: Array<{ title?: string; url: string }>;
    metrics_context: { current_value: number; baseline_value: number; metric_name: string; delta_percentage: number };
    ai_diagnosis?: { root_cause: string; explanation: string };
  }>;
  integrations: Array<{ provider: string; status: string; updated_at: string }>;
  commits: { by_status: Record<string, number> };
  actions: { by_status: Record<string, number> };
}

interface TeamHealthData {
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    color: string;
    leakCount: number;
    activeLeaks: number;
    eventCount7d: number;
    metrics: Record<string, { value: number; baseline: number }>;
    healthScore: number;
  }>;
  company_health_score: number;
}

// ──────────────── Constants ────────────────

const leakTypeLabels: Record<string, string> = {
  decision_drift: "Decision Drift",
  unlogged_action_items: "Unlogged Actions",
  reopen_bounce_spike: "Reopen Spike",
  cycle_time_drift: "Cycle Time Drift",
  pr_review_bottleneck: "PR Review Bottleneck",
};

const metricLabels: Record<string, string> = {
  "jira.cycle_time_median": "Cycle Time",
  "github.pr_review_latency_median": "PR Review",
  "slack.unresolved_threads": "Unresolved",
  "github.pr_age_median": "PR Age",
  "jira.reopen_rate": "Reopen Rate",
  "slack.thread_length_median": "Thread Len",
};

const metricUnits: Record<string, string> = {
  "jira.cycle_time_median": "h",
  "github.pr_review_latency_median": "h",
  "slack.unresolved_threads": "",
  "github.pr_age_median": "h",
  "jira.reopen_rate": "%",
  "slack.thread_length_median": " msgs",
};

const severityColor = (s: number) =>
  s >= 70 ? "text-red-400" : s >= 50 ? "text-amber-400" : "text-yellow-400";

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    detected: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    delivered: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    actioned: "bg-green-500/15 text-green-400 border-green-500/30",
    snoozed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    suppressed: "bg-gray-500/15 text-gray-500 border-gray-600/30",
    resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    active: "bg-green-500/15 text-green-400 border-green-500/30",
    inactive: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  return map[status] || "bg-gray-500/15 text-gray-400 border-gray-500/30";
};

function healthScoreColor(score: number) {
  if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500", bar: "bg-emerald-500/80" };
  if (score >= 60) return { text: "text-amber-400", bg: "bg-amber-500", bar: "bg-amber-500/80" };
  return { text: "text-red-400", bg: "bg-red-500", bar: "bg-red-500/80" };
}

function formatMetricValue(key: string, value: number): string {
  const unit = metricUnits[key] || "";
  if (key === "jira.reopen_rate") return `${(value * 100).toFixed(0)}%`;
  if (unit === "h") return `${value.toFixed(1)}h`;
  return `${Math.round(value)}${unit}`;
}

// ──────────────── Main Component ────────────────

export default function DashboardOverview() {
  const { scopeParams, teamId, teams } = useScope();
  const selectedTeam = teams.find((t) => t.id === teamId);

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["dashboard-overview", scopeParams],
    queryFn: () => apiFetch(`/api/dashboard/overview${scopeParams ? `?${scopeParams}` : ""}`),
    refetchInterval: 30000,
  });

  const { data: healthData } = useQuery<TeamHealthData>({
    queryKey: ["teams-health"],
    queryFn: () => apiFetch("/api/teams/health"),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
              <CardContent className="pt-6"><div className="h-16" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="pt-6 text-center text-gray-400">
            <p>Unable to load dashboard data.</p>
            <p className="text-sm mt-1">Make sure your API is running on port 3001 and the database is seeded.</p>
            <code className="text-xs mt-4 block text-cyan-400">npm run seed:dev</code>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalCost = data.recent_leaks
    .filter((l) => l.status !== "resolved" && l.status !== "suppressed")
    .reduce((acc, l) => acc + (l.cost_estimate_hours_per_week || 0), 0);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-8">
      {/* ──── Header with Health Score ──── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {selectedTeam ? `${selectedTeam.name}` : "Dashboard"}
          </h1>
          <p className="text-gray-400 mt-1">
            {data.company?.name || "FlowGuard"} — {today}
          </p>
        </div>
        {healthData && (
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/60 border border-gray-800 rounded-xl">
            <Shield className={`h-6 w-6 ${healthScoreColor(healthData.company_health_score).text}`} />
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Health Score</p>
              <p className={`text-2xl font-bold ${healthScoreColor(healthData.company_health_score).text}`}>
                {healthData.company_health_score}<span className="text-sm text-gray-500">/100</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ──── Stats Row ──── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={AlertTriangle}
          label="Active Leaks"
          value={String((data.leaks.by_status.detected || 0) + (data.leaks.by_status.delivered || 0))}
          subtitle={`${data.leaks.total} total detected`}
          color="text-amber-400"
        />
        <StatCard
          icon={Clock}
          label="Est. Hours Lost / Week"
          value={`${totalCost}h`}
          subtitle="From unresolved leaks"
          color="text-red-400"
        />
        <StatCard
          icon={Activity}
          label="Events (7d)"
          value={String(data.events.total)}
          subtitle={Object.entries(data.events.by_source || {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "No events"}
          color="text-cyan-400"
        />
        <StatCard
          icon={CheckSquare}
          label="Pending Approvals"
          value={String(data.actions.by_status?.pending || 0)}
          subtitle={`${data.actions.by_status?.executed || 0} executed`}
          color="text-green-400"
        />
      </div>

      {/* ──── Team Comparison Grid ──── */}
      {healthData && healthData.teams.length > 0 && !selectedTeam && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-400" />
            Team Comparison
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {healthData.teams.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        </div>
      )}

      {/* ──── Integrations ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {["slack", "jira", "github"].map((provider) => {
          const integ = data.integrations.find((i) => i.provider === provider);
          return (
            <Card key={provider} className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-5 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-gray-500" />
                  <span className="font-medium capitalize">{provider}</span>
                </div>
                <Badge className={statusBadge(integ?.status || "inactive")} variant="outline">
                  {integ?.status || "not connected"}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ──── Recent Leaks + Ledger Stats ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Leaks */}
        <div className="lg:col-span-2">
          <Card className="bg-gray-900/60 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Recent Leaks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recent_leaks.length === 0 ? (
                <p className="text-gray-500 text-sm">No leaks detected yet.</p>
              ) : (
                data.recent_leaks.map((leak) => (
                  <div
                    key={leak.id}
                    className="flex items-start justify-between gap-4 p-3 rounded-lg bg-gray-800/40 border border-gray-800"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {leakTypeLabels[leak.leak_type] || leak.leak_type}
                        </span>
                        <Badge className={statusBadge(leak.status)} variant="outline">
                          {leak.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {leak.ai_diagnosis?.root_cause || leak.evidence_links[0]?.title || "No details"}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span className={severityColor(leak.severity)}>
                          Sev: {leak.severity}
                        </span>
                        <span>Conf: {(leak.confidence * 100).toFixed(0)}%</span>
                        {leak.cost_estimate_hours_per_week && (
                          <span className="text-red-400/70">
                            ~{leak.cost_estimate_hours_per_week}h/wk lost
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(leak.detected_at).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary Cards */}
        <div className="space-y-4">
          <Card className="bg-gray-900/60 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <GitCommit className="h-4 w-4 text-cyan-400" />
                Memory Ledger
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {Object.entries(data.commits.by_status || {}).map(([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <span className="text-gray-400 capitalize">{status}</span>
                    <span className="font-mono">{count as number}</span>
                  </div>
                ))}
                {Object.keys(data.commits.by_status || {}).length === 0 && (
                  <p className="text-gray-500 text-xs">No commits yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900/60 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                Remediation Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {Object.entries(data.actions.by_status || {}).map(([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <span className="text-gray-400 capitalize">{status}</span>
                    <span className="font-mono">{count as number}</span>
                  </div>
                ))}
                {Object.keys(data.actions.by_status || {}).length === 0 && (
                  <p className="text-gray-500 text-xs">No actions yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ──────────────── Team Card ────────────────

function TeamCard({ team }: { team: TeamHealthData["teams"][number] }) {
  const score = team.healthScore;
  const colors = healthScoreColor(score);
  const keyMetrics = ["jira.cycle_time_median", "github.pr_review_latency_median", "slack.unresolved_threads"];

  return (
    <Card className="bg-gray-900/60 border-gray-800 hover:border-gray-700 transition-colors">
      <CardContent className="pt-5 pb-4 space-y-4">
        {/* Team header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: team.color || "#6366f1" }}
            />
            <span className="font-semibold text-sm">{team.name}</span>
          </div>
          <span className={`text-xl font-bold ${colors.text}`}>
            {score}
          </span>
        </div>

        {/* Health bar */}
        <div className="w-full h-1.5 bg-gray-800 rounded-full">
          <div
            className={`h-full rounded-full transition-all ${colors.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {/* Key metrics */}
        <div className="space-y-2">
          {keyMetrics.map((key) => {
            const m = team.metrics[key];
            if (!m) return null;
            const delta = m.baseline > 0 ? ((m.value - m.baseline) / m.baseline) * 100 : 0;
            const isWorse = delta > 10;
            const isBetter = delta < -10;
            return (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{metricLabels[key] || key}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-gray-200">{formatMetricValue(key, m.value)}</span>
                  {isWorse && <ArrowUpRight className="h-3 w-3 text-red-400" />}
                  {isBetter && <ArrowDownRight className="h-3 w-3 text-emerald-400" />}
                  {!isWorse && !isBetter && <Minus className="h-3 w-3 text-gray-600" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom stats */}
        <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-gray-800/50">
          <span>{team.eventCount7d} events (7d)</span>
          {team.activeLeaks > 0 ? (
            <span className="text-amber-400">{team.activeLeaks} active leak{team.activeLeaks > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-emerald-500">No active leaks</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────── Stat Card ────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle: string;
  color: string;
}) {
  return (
    <Card className="bg-gray-900/60 border-gray-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          </div>
          <Icon className={`h-5 w-5 ${color} opacity-60`} />
        </div>
      </CardContent>
    </Card>
  );
}
