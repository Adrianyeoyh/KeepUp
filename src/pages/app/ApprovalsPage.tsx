import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CheckSquare, ThumbsUp, ThumbsDown, Clock, Loader2, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";

interface ProposedAction {
  id: string;
  action_type: string;
  target_system: string;
  target_id: string;
  preview_diff: { description?: string; after?: string; structured?: Record<string, unknown> };
  risk_level: string;
  blast_radius: string;
  approval_status: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  leak_type?: string;
  leak_severity?: number;
}

interface ApprovalsResponse {
  actions: ProposedAction[];
  total: number;
}

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  executed: "bg-green-500/15 text-green-400 border-green-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
};

const actionTypeLabels: Record<string, string> = {
  create_jira_issue: "Create Jira Issue",
  update_jira_issue: "Update Jira Issue",
  post_slack_message: "Post Slack Message",
  create_github_issue: "Create GitHub Issue",
  update_channel_topic: "Update Channel Topic",
};

export default function ApprovalsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const limit = 15;
  const queryClient = useQueryClient();

  const { scopeParams } = useScope();

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (scopeParams) {
    for (const part of scopeParams.split("&")) {
      const [k, v] = part.split("=");
      if (k && v) params.set(k, v);
    }
  }

  const { data, isLoading } = useQuery<ApprovalsResponse>({
    queryKey: ["approvals", page, statusFilter, scopeParams],
    queryFn: () => apiFetch(`/api/approvals?${params.toString()}`),
    refetchInterval: 15000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiFetch(`/api/approvals/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, approved_by: "admin", rationale: rationale[id] }),
      }),
    onSuccess: (_data, variables) => {
      // Record feedback for the flywheel
      const feedbackType = variables.action === "approve" ? "approval_rationale" : "rejection_rationale";
      apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_type: feedbackType,
          entity_id: variables.id,
          entity_type: "proposed_action",
          actor_id: "admin",
          reason: rationale[variables.id] || undefined,
        }),
      }).catch(() => {}); // fire-and-forget
      setRationale((prev) => { const n = { ...prev }; delete n[variables.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CheckSquare className="h-6 w-6 text-green-400" />
          Approvals
        </h1>
        <p className="text-gray-400 mt-1">
          Review and approve proposed remediation actions before execution
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="executed">Executed</option>
          <option value="rejected">Rejected</option>
        </select>
        <div className="ml-auto text-sm text-gray-500">
          {data?.total || 0} total actions
        </div>
      </div>

      {/* Actions List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
              <CardContent className="pt-5"><div className="h-20" /></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.actions || []).map((action) => (
            <Card key={action.id} className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-medium">
                        {actionTypeLabels[action.action_type] || action.action_type}
                      </span>
                      <Badge className={statusStyles[action.approval_status] || statusStyles.pending} variant="outline">
                        {action.approval_status}
                      </Badge>
                      <Badge className="bg-gray-700/50 text-gray-300 border-gray-600/50" variant="outline">
                        {action.target_system}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-300">{action.preview_diff?.description || action.action_type}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>Created: {new Date(action.created_at).toLocaleString()}</span>
                      {action.approved_by && <span>By: {action.approved_by}</span>}
                      {action.approved_at && (
                        <span>Approved: {new Date(action.approved_at).toLocaleString()}</span>
                      )}
                      {action.leak_type && (
                        <span className="text-amber-400/70">
                          Leak: {action.leak_type.replace(/_/g, " ")}
                        </span>
                      )}
                      {action.risk_level && (
                        <span>Risk: {action.risk_level}</span>
                      )}
                    </div>

                    {/* Payload preview */}
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                        View payload
                      </summary>
                      <pre className="mt-1 text-xs text-gray-400 bg-gray-800/60 rounded p-2 overflow-x-auto max-h-32">
                        {JSON.stringify(action.preview_diff, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {/* Actions */}
                  {action.approval_status === "pending" && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none w-32"
                        rows={2}
                        placeholder="Rationale (optional)"
                        value={rationale[action.id] || ""}
                        onChange={(e) => setRationale((prev) => ({ ...prev, [action.id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={actionMutation.isPending}
                        onClick={() => actionMutation.mutate({ id: action.id, action: "approve" })}
                      >
                        {actionMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ThumbsUp className="h-4 w-4 mr-1" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-600/50 text-red-400 hover:bg-red-600/10"
                        disabled={actionMutation.isPending}
                        onClick={() => actionMutation.mutate({ id: action.id, action: "reject" })}
                      >
                        <ThumbsDown className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(data?.actions || []).length === 0 && (
            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-6 text-center text-gray-500">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No proposed actions match your filters.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" className="border-gray-700 text-gray-400" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" className="border-gray-700 text-gray-400" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
