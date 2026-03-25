import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { TrendingUp, Calendar, Users, GitCompare, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { useScope } from "@/hooks/useScope";

// ──────────────── Types ────────────────

interface MetricPoint {
  date: string;
  metric_name: string;
  value: number;
}

interface MetricsResponse {
  metrics: MetricPoint[];
}

interface TeamCompareResponse {
  series: Array<{
    team_id: string;
    team_name: string;
    team_color: string | null;
    series: Array<{ date: string; value: number }>;
  }>;
  org_baseline: Array<{ date: string; value: number }>;
}

interface TeamHealth {
  id: string;
  name: string;
  color: string;
}

interface AnomalyLeak {
  id: string;
  leak_type: string;
  severity: string;
  detected_at: string;
  summary: string;
  metrics_context: Record<string, unknown> | null;
  jira_issue_key: string | null;
}

// ──────────────── Constants ────────────────

const METRICS = [
  { key: "slack.thread_length_median", label: "Thread Length (Median)", color: "#06b6d4", unit: "" },
  { key: "slack.unresolved_threads", label: "Unresolved Threads", color: "#10b981", unit: "" },
  { key: "jira.cycle_time_median", label: "Jira Cycle Time (Median)", color: "#f59e0b", unit: "hrs" },
  { key: "jira.reopen_rate", label: "Jira Reopen Rate", color: "#8b5cf6", unit: "" },
  { key: "github.pr_review_latency_median", label: "PR Review Latency (Median)", color: "#ec4899", unit: "hrs" },
  { key: "github.pr_age_median", label: "PR Age (Median)", color: "#22d3ee", unit: "hrs" },
];

const RANGES = [
  { value: "7", label: "7 Days" },
  { value: "14", label: "14 Days" },
  { value: "30", label: "30 Days" },
  { value: "90", label: "90 Days" },
];

// ──────────────── Component ────────────────

export default function MetricsPage() {
  const [days, setDays] = useState("14");
  const [compareMode, setCompareMode] = useState(false);
  const [compareMetric, setCompareMetric] = useState("jira.cycle_time_median");
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(
    new Set(["slack.thread_length_median", "jira.cycle_time_median", "github.pr_review_latency_median"])
  );

  const { scopeParams, teams } = useScope();

  // Standard metrics query (company or scoped)
  const { data, isLoading } = useQuery<MetricsResponse>({
    queryKey: ["metrics", days, scopeParams],
    queryFn: () => {
      const p = new URLSearchParams({ days });
      if (scopeParams) {
        for (const part of scopeParams.split("&")) {
          const [k, v] = part.split("=");
          if (k && v) p.set(k, v);
        }
      }
      return apiFetch(`/api/metrics?${p.toString()}`);
    },
    refetchInterval: 60000,
  });

  // Multi-team comparison query
  const { data: compareData, isLoading: compareLoading } = useQuery<TeamCompareResponse>({
    queryKey: ["compare-metrics", compareMetric, days],
    queryFn: () =>
      apiFetch(`/api/compare/metrics?metric_name=${compareMetric}&days=${days}`),
    enabled: compareMode,
    refetchInterval: 120000,
  });

  // Leaks for anomaly markers
  const { data: leaksData } = useQuery<{ leaks: AnomalyLeak[] }>({
    queryKey: ["leaks-anomaly", days],
    queryFn: () => apiFetch(`/api/leaks?days=${days}&limit=50`),
    refetchInterval: 120000,
  });

  // Build anomaly markers mapped by date
  const anomalyMarkers = (() => {
    if (!leaksData?.leaks) return new Map<string, AnomalyLeak[]>();
    const map = new Map<string, AnomalyLeak[]>();
    for (const leak of leaksData.leaks) {
      const date = new Date(leak.detected_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(leak);
    }
    return map;
  })();

  // Transform standard data for Recharts
  const chartData = (() => {
    if (!data?.metrics) return [];
    const map = new Map<string, Record<string, number | string>>();
    for (const row of data.metrics) {
      const date = new Date(row.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!map.has(date)) map.set(date, { date });
      const entry = map.get(date)!;
      entry[row.metric_name] = Number(row.value.toFixed(2));
    }
    return Array.from(map.values());
  })();

  // Transform compare data for Recharts
  const compareChartData = (() => {
    if (!compareData) return [];
    const map = new Map<string, Record<string, number | string>>();

    // Add org baseline
    for (const row of compareData.org_baseline || []) {
      const date = new Date(row.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!map.has(date)) map.set(date, { date });
      map.get(date)!["org_baseline"] = Number(row.value.toFixed(2));
    }

    // Add per-team series
    for (const s of compareData.series || []) {
      for (const row of s.series) {
        const date = new Date(row.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (!map.has(date)) map.set(date, { date });
        map.get(date)![s.team_id] = Number(row.value.toFixed(2));
      }
    }

    return Array.from(map.values());
  })();

  // Compute org baseline average for reference line
  const orgBaseline = (() => {
    if (!compareData?.org_baseline?.length) return null;
    const values = compareData.org_baseline.map((p) => p.value);
    return values.reduce((a, b) => a + b, 0) / values.length;
  })();

  // Derive team colors map
  const teamColorMap = new Map<string, { name: string; color: string }>();
  for (const team of teams || []) {
    teamColorMap.set(team.id, { name: team.name, color: (team as any).color || "#6366f1" });
  }
  // Also use compare data for team names/colors
  for (const s of compareData?.series || []) {
    if (!teamColorMap.has(s.team_id)) {
      teamColorMap.set(s.team_id, { name: s.team_name, color: s.team_color || "#6366f1" });
    }
  }

  const toggleMetric = (key: string) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Latest values
  const latestValues = (() => {
    if (!data?.metrics) return {};
    const byMetric: Record<string, MetricPoint[]> = {};
    for (const row of data.metrics) {
      if (!byMetric[row.metric_name]) byMetric[row.metric_name] = [];
      byMetric[row.metric_name].push(row);
    }
    const result: Record<string, number> = {};
    for (const [name, points] of Object.entries(byMetric)) {
      const sorted = points.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      result[name] = sorted[0]?.value ?? 0;
    }
    return result;
  })();

  const selectedMetricLabel = METRICS.find((m) => m.key === compareMetric)?.label || compareMetric;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-green-400" />
            Metrics
          </h1>
          <p className="text-gray-400 mt-1">
            Five Golden Rules health metrics over time
          </p>
        </div>
        <Button
          variant={compareMode ? "default" : "outline"}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          className={compareMode
            ? "bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30"
            : "text-gray-400 border-gray-700"}
        >
          <GitCompare className="h-4 w-4 mr-1.5" />
          {compareMode ? "Comparing Teams" : "Compare Teams"}
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <select
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {compareMode ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <select
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
              value={compareMetric}
              onChange={(e) => setCompareMetric(e.target.value)}
            >
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {METRICS.map((m) => (
              <button
                key={m.key}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  selectedMetrics.has(m.key)
                    ? "border-transparent text-white"
                    : "border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
                style={selectedMetrics.has(m.key) ? { backgroundColor: m.color + "30", color: m.color } : {}}
                onClick={() => toggleMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Summary Cards (standard mode only) */}
      {!compareMode && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {METRICS.map((m) => {
            const val = latestValues[m.key];
            return (
              <Card key={m.key} className="bg-gray-900/60 border-gray-800">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-gray-400 truncate">{m.label}</p>
                  <p className="text-xl font-bold mt-1" style={{ color: m.color }}>
                    {val !== undefined ? val.toFixed(1) : "—"}{m.unit}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Team Legend (compare mode) */}
      {compareMode && compareData && (
        <div className="flex flex-wrap items-center gap-3 px-2">
          {(compareData.series || []).map((series) => {
            const teamInfo = teamColorMap.get(series.team_id);
            const color = teamInfo?.color || "#6366f1";
            return (
              <div key={series.team_id} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-gray-300">{series.team_name}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-3 h-0.5 rounded-full border border-dashed border-gray-400" />
            <span className="text-gray-500">Org Baseline</span>
          </div>
        </div>
      )}

      {/* Chart */}
      <Card className="bg-gray-900/60 border-gray-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {compareMode ? `Team Comparison — ${selectedMetricLabel}` : "Trend"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(compareMode ? compareLoading : isLoading) ? (
            <div className="h-64 flex items-center justify-center text-gray-500">Loading chart data...</div>
          ) : (compareMode ? compareChartData.length === 0 : chartData.length === 0) ? (
            <div className="h-64 flex items-center justify-center text-gray-500">
              No metric data available. Run <code className="text-cyan-400 mx-1">npm run seed:dev</code> to populate.
            </div>
          ) : compareMode ? (
            /* ──── Team Comparison Chart ──── */
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={compareChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#9CA3AF", fontSize: 12 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 12 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#E5E7EB",
                  }}
                />
                <Legend />
                {/* Org baseline reference line */}
                {orgBaseline !== null && (
                  <ReferenceLine
                    y={Number(orgBaseline.toFixed(2))}
                    stroke="#6B7280"
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                    label={{ value: "Org", position: "right", fill: "#6B7280", fontSize: 11 }}
                  />
                )}
                {/* Org baseline line in chart */}
                <Line
                  type="monotone"
                  dataKey="org_baseline"
                  name="Org Baseline"
                  stroke="#6B7280"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  dot={false}
                />
                {/* Per-team lines */}
                {(compareData?.series || []).map((series) => {
                  const teamInfo = teamColorMap.get(series.team_id);
                  const color = teamInfo?.color || "#6366f1";
                  return (
                    <Line
                      key={series.team_id}
                      type="monotone"
                      dataKey={series.team_id}
                      name={series.team_name}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: color }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            /* ──── Standard Chart ──── */
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#9CA3AF", fontSize: 12 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 12 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#E5E7EB",
                  }}
                />
                <Legend />
                {METRICS.filter((m) => selectedMetrics.has(m.key)).map((m) => (
                  <Line
                    key={m.key}
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Anomaly Markers */}
      {anomalyMarkers.size > 0 && (
        <Card className="bg-gray-900/60 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Anomaly Markers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from(anomalyMarkers.entries())
                .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                .map(([date, leaks]) =>
                  leaks.map((leak) => {
                    const severityColor =
                      leak.severity === "high" ? "text-red-400" :
                      leak.severity === "medium" ? "text-amber-400" : "text-yellow-400";
                    const severityDot =
                      leak.severity === "high" ? "bg-red-400" :
                      leak.severity === "medium" ? "bg-amber-400" : "bg-yellow-400";
                    const typeLabel = leak.leak_type.replace(/_/g, " ");
                    return (
                      <a
                        key={leak.id}
                        href={`/app/leaks?id=${encodeURIComponent(leak.id)}`}
                        className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-800/50 transition-colors group"
                      >
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${severityDot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-400">{date}:</span>
                            <span className={`font-medium capitalize ${severityColor}`}>{typeLabel}</span>
                            {leak.jira_issue_key && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {leak.jira_issue_key}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 truncate group-hover:text-gray-400">
                            {leak.summary}
                          </p>
                        </div>
                      </a>
                    );
                  })
                )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
