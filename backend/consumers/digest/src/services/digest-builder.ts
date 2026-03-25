/**
 * Digest Builder — Constructs Slack Block Kit digest payloads.
 *
 * Migrated from apps/worker/src/services/digest-builder.ts.
 * Key changes:
 *   - NO direct @slack/web-api imports
 *   - Blocks are structured data passed to adapterRegistry.executeAction()
 *
 * All business logic preserved from the original implementation.
 */

export type LeakDigestRow = {
  id: string;
  company_id: string;
  leak_type: string;
  severity: number;
  confidence: number;
  evidence_links: Array<{ url: string; title?: string; entity_id?: string }>;
  metrics_context: {
    current_value: number;
    baseline_value: number;
    metric_name: string;
    delta_percentage: number;
  };
  recommended_fix: {
    summary?: string;
    action_type?: string;
    details?: Record<string, unknown>;
  };
  cost_estimate_hours_per_week?: number | null;
  ai_diagnosis?: {
    explanation?: string;
    root_cause?: string;
  } | null;
};

export type DigestRole = 'ic' | 'lead' | 'exec';

function prettyLeakType(leakType: string): string {
  switch (leakType) {
    case 'decision_drift':
      return 'Decision Drift';
    case 'unlogged_action_items':
      return 'Unlogged Action Items';
    case 'reopen_bounce_spike':
      return 'Jira Reopen Spike';
    case 'cycle_time_drift':
      return 'Cycle Time Drift';
    case 'pr_review_bottleneck':
      return 'PR Review Bottleneck';
    default:
      return leakType;
  }
}

function formatEvidenceLinks(evidenceLinks: LeakDigestRow['evidence_links']): string {
  if (!Array.isArray(evidenceLinks) || evidenceLinks.length === 0) {
    return 'No evidence links available.';
  }

  return evidenceLinks
    .slice(0, 2)
    .map((link) => `<${link.url}|${link.title || link.entity_id || 'Evidence'}>`)
    .join(' · ');
}

function toActionValue(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export function buildDigestBlocks(
  leaks: LeakDigestRow[],
  role: DigestRole = 'lead',
): Array<Record<string, unknown>> {
  const roleLabel = role === 'exec' ? 'Executive' : role === 'ic' ? 'IC' : 'Lead';

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `FlowGuard ${roleLabel} Digest` },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: role === 'exec'
            ? `${leaks.length} insight(s) · Cross-team summary · Trend highlights`
            : role === 'ic'
              ? `${Math.min(leaks.length, 3)} insight(s) · Actionable items for your scope`
              : `Top ${Math.min(leaks.length, 3)} insights · Evidence-linked · Human-gated actions`,
        },
      ],
    },
    { type: 'divider' },
  ];

  leaks.slice(0, 3).forEach((leak, index) => {
    const baseline = leak.metrics_context?.baseline_value ?? 0;
    const current = leak.metrics_context?.current_value ?? 0;
    const delta = leak.metrics_context?.delta_percentage ?? 0;
    const metricName = leak.metrics_context?.metric_name || 'metric';

    const description = leak.ai_diagnosis?.explanation || leak.recommended_fix?.summary || 'Leak detected.';
    const weeklyCost = leak.cost_estimate_hours_per_week
      ? ` · est ${leak.cost_estimate_hours_per_week.toFixed(1)} hrs/week`
      : '';

    const baseActionPayload = {
      company_id: leak.company_id,
      leak_instance_id: leak.id,
      action_type: leak.recommended_fix?.action_type || 'slack_reminder',
      description: leak.recommended_fix?.summary || 'FlowGuard remediation draft',
      target_id: leak.evidence_links?.[0]?.entity_id,
    };

    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}. ${prettyLeakType(leak.leak_type)}*\nSeverity *${leak.severity}* · Confidence *${Math.round(leak.confidence * 100)}%*${weeklyCost}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${description}\n• Metric: *${metricName}* | Current *${current.toFixed(2)}* vs Baseline *${baseline.toFixed(2)}* (${delta.toFixed(1)}%)\n• Evidence: ${formatEvidenceLinks(leak.evidence_links)}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Create Decision Commit' },
            action_id: 'create_decision_commit',
            value: toActionValue(baseActionPayload),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Create Action Commit' },
            action_id: 'create_action_commit',
            value: toActionValue(baseActionPayload),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Propose Fix' },
            action_id: 'propose_fix',
            value: toActionValue(baseActionPayload),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve Fix' },
            action_id: 'approve_fix',
            value: toActionValue(baseActionPayload),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Snooze' },
            action_id: 'snooze',
            value: toActionValue(baseActionPayload),
          },
        ],
      },
      { type: 'divider' },
    );
  });

  return blocks;
}
