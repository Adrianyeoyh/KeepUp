import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { AlertTriangle, Search, Filter, ChevronLeft, ChevronRight, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { EvidenceCardList } from "@/components/EvidenceCard";

interface Leak {
  id: string;
  leak_type: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
  cost_estimate_hours_per_week: number | null;
  evidence_links: Array<{ title?: string; url: string }>;
  metrics_context: { current_value: number; baseline_value: number; metric_name: string; delta_percentage: number; semantic_explanation?: string };
  ai_diagnosis?: { root_cause: string; explanation: string; suggested_actions: string[] };
}

interface LeaksResponse {
  leaks: Leak[];
  total: number;
}

const leakTypeLabels: Record<string, string> = {
  decision_drift: "Decision Drift",
  unlogged_action_items: "Unlogged Actions",
  reopen_bounce_spike: "Reopen Spike",
  cycle_time_drift: "Cycle Time Drift",
  pr_review_bottleneck: "PR Review Bottleneck",
};

const severityColor = (s: number) =>
  s >= 70 ? "text-red-400" : s >= 50 ? "text-amber-400" : "text-yellow-400";

const statusVariant = (status: string) => {
  const map: Record<string, string> = {
    detected: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    delivered: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    actioned: "bg-green-500/15 text-green-400 border-green-500/30",
    resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    snoozed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    suppressed: "bg-gray-600/15 text-gray-500 border-gray-600/30",
  };
  return map[status] || "bg-gray-500/15 text-gray-400 border-gray-500/30";
};

const LEAK_TYPES = ["all", "decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"];
const STATUSES = ["all", "detected", "delivered", "actioned", "resolved", "snoozed", "suppressed", "dismissed"];

export default function LeaksPage() {
  const [page, setPage] = useState(1);
  const [leakType, setLeakType] = useState("all");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState<Record<string, string>>({});
  const limit = 15;
  const queryClient = useQueryClient();

  const { scopeParams } = useScope();

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (leakType !== "all") params.set("leak_type", leakType);
  if (status !== "all") params.set("status", status);
  if (scopeParams) {
    for (const part of scopeParams.split("&")) {
      const [k, v] = part.split("=");
      if (k && v) params.set(k, v);
    }
  }

  const { data, isLoading } = useQuery<LeaksResponse>({
    queryKey: ["leaks", page, leakType, status, scopeParams],
    queryFn: () => apiFetch(`/api/leaks?${params.toString()}`),
    refetchInterval: 30000,
  });

  const dismissMutation = useMutation({
    mutationFn: (leakId: string) =>
      apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_type: "leak_dismissal",
          entity_id: leakId,
          entity_type: "leak_instance",
          actor_id: "admin",
          reason: dismissReason[leakId] || "False positive",
        }),
      }),
    onSuccess: (_data, leakId) => {
      setDismissReason((p) => { const n = { ...p }; delete n[leakId]; return n; });
      queryClient.invalidateQueries({ queryKey: ["leaks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          Leaks
        </h1>
        <p className="text-gray-400 mt-1">Golden Rules violations detected across your integrations</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            value={leakType}
            onChange={(e) => { setLeakType(e.target.value); setPage(1); }}
          >
            {LEAK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All Types" : leakTypeLabels[t] || t}
              </option>
            ))}
          </select>
          <select
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          {data?.total || 0} total leaks
        </div>
      </div>

      {/* Leaks List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
              <CardContent className="pt-5"><div className="h-14" /></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.leaks || []).map((leak) => (
            <Card
              key={leak.id}
              className="bg-gray-900/60 border-gray-800 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => setExpanded(expanded === leak.id ? null : leak.id)}
            >
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {leakTypeLabels[leak.leak_type] || leak.leak_type}
                      </span>
                      <Badge className={statusVariant(leak.status)} variant="outline">
                        {leak.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      {leak.ai_diagnosis?.root_cause || "AI diagnosis pending..."}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span className={severityColor(leak.severity)}>
                        Severity: {leak.severity}
                      </span>
                      <span>Confidence: {(leak.confidence * 100).toFixed(0)}%</span>
                      {leak.cost_estimate_hours_per_week && (
                        <span className="text-red-400/70">
                          ~{leak.cost_estimate_hours_per_week}h/wk cost
                        </span>
                      )}
                      <span>Δ {leak.metrics_context?.delta_percentage?.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 whitespace-nowrap">
                    {new Date(leak.detected_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Expanded Detail */}
                {expanded === leak.id && (
                  <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
                    {leak.ai_diagnosis && (
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1">AI Explanation</p>
                        <p className="text-sm text-gray-300">{leak.ai_diagnosis.explanation}</p>
                        {leak.ai_diagnosis.suggested_actions?.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-gray-400 mb-1">Suggested Actions</p>
                            <ul className="list-disc list-inside text-sm text-gray-400 space-y-0.5">
                              {leak.ai_diagnosis.suggested_actions.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1">Metric Context</p>
                        <div className="text-sm text-gray-300 space-y-0.5">
                          <p>Metric: {leak.metrics_context?.metric_name}</p>
                          <p>Current: {leak.metrics_context?.current_value} → Baseline: {leak.metrics_context?.baseline_value}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1">Evidence</p>
                        <EvidenceCardList links={leak.evidence_links || []} />
                      </div>
                    </div>
                    {/* Semantic Explanation */}
                    {leak.metrics_context?.semantic_explanation && (
                      <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                        <p className="text-xs font-medium text-blue-400 mb-1.5 flex items-center gap-1.5">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
                          Why this matters
                        </p>
                        <p className="text-sm text-gray-300 leading-relaxed">
                          {leak.metrics_context.semantic_explanation}
                        </p>
                      </div>
                    )}
                    {/* Dismiss as false positive */}
                    {(leak.status === "detected" || leak.status === "delivered") && (
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                        <input
                          className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 flex-1"
                          placeholder="Dismiss reason (optional)"
                          value={dismissReason[leak.id] || ""}
                          onChange={(e) => setDismissReason((p) => ({ ...p, [leak.id]: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-600 text-gray-400 hover:bg-gray-800"
                          disabled={dismissMutation.isPending}
                          onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(leak.id); }}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {(data?.leaks || []).length === 0 && (
            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-6 text-center text-gray-500">
                No leaks match your filters.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-gray-700 text-gray-400"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-gray-700 text-gray-400"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
