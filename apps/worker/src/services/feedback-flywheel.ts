import { query } from '../db/client.js';
import { logger } from '../logger.js';

/**
 * Feedback Flywheel Service
 *
 * Records user feedback signals (approve/reject rationale, leak dismissals,
 * scope corrections) and uses them to calibrate AI confidence thresholds
 * per team.
 *
 * Tables used:
 *  - feedback_signals (created or appended to events.metadata)
 *  - We store feedback as events with source='feedback'
 *  - Per-team threshold calibration in company settings
 */

export type FeedbackType =
  | 'approval_rationale'
  | 'rejection_rationale'
  | 'leak_dismissal'
  | 'scope_correction';

interface FeedbackInput {
  companyId: string;
  feedbackType: FeedbackType;
  entityId: string;
  entityType: 'proposed_action' | 'leak_instance' | 'entity_link';
  actorId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record a feedback signal as an event.
 */
export async function recordFeedback(input: FeedbackInput): Promise<void> {
  const log = logger.child({ companyId: input.companyId, feedbackType: input.feedbackType });

  await query(
    `INSERT INTO events (
      company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id
    ) VALUES ($1, 'feedback', $2, $3, NOW(), $4, $5)
    ON CONFLICT (provider_event_id, source, company_id) DO NOTHING`,
    [
      input.companyId,
      input.entityId,
      `feedback.${input.feedbackType}`,
      JSON.stringify({
        entity_type: input.entityType,
        actor_id: input.actorId,
        reason: input.reason,
        ...input.metadata,
      }),
      `fb:${input.companyId}:${input.entityType}:${input.entityId}:${input.feedbackType}`,
    ],
  );

  log.info({ entityId: input.entityId }, 'Feedback signal recorded');
}

/**
 * Per-team threshold calibration.
 * Adjusts confidence_threshold per team based on feedback signal patterns.
 *
 * Logic:
 *  - If a team has many false positives (dismissals / rejections), raise threshold
 *  - If a team has many true positives (approvals), lower threshold slightly
 *  - Clamps to [0.3, 0.95]
 */
export async function runThresholdCalibration(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'threshold-calibration' });

  // Get team-level feedback stats for last 30 days
  const statsResult = await query<{
    team_id: string;
    false_positives: string;
    true_positives: string;
  }>(
    `WITH fb AS (
       SELECT
         e.metadata->>'team_id' AS team_id,
         CASE
           WHEN e.event_type IN ('feedback.rejection_rationale', 'feedback.leak_dismissal') THEN 'fp'
           WHEN e.event_type IN ('feedback.approval_rationale') THEN 'tp'
         END AS signal
       FROM events e
       WHERE e.company_id = $1
         AND e.source = 'feedback'
         AND e.timestamp > NOW() - INTERVAL '30 days'
         AND e.event_type LIKE 'feedback.%'
     )
     SELECT
       team_id,
       COUNT(*) FILTER (WHERE signal = 'fp') AS false_positives,
       COUNT(*) FILTER (WHERE signal = 'tp') AS true_positives
     FROM fb
     WHERE team_id IS NOT NULL
     GROUP BY team_id`,
    [companyId],
  );

  if (statsResult.rows.length === 0) {
    log.debug('No team feedback data for calibration');
    return;
  }

  // Load current settings
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const baseThreshold = (settings.confidence_threshold as number) ?? 0.6;
  const teamThresholds = (settings.team_thresholds as Record<string, number>) || {};

  for (const row of statsResult.rows) {
    const fp = Number(row.false_positives);
    const tp = Number(row.true_positives);
    const total = fp + tp;
    if (total < 3) continue; // need enough data

    const fpRate = fp / total;
    const current = teamThresholds[row.team_id] ?? baseThreshold;

    let adjusted = current;
    if (fpRate > 0.5) {
      // Too many false positives — raise threshold
      adjusted = Math.min(0.95, current + 0.03);
    } else if (fpRate < 0.2) {
      // Good signal — lower threshold slightly
      adjusted = Math.max(0.3, current - 0.02);
    }

    if (adjusted !== current) {
      teamThresholds[row.team_id] = Math.round(adjusted * 100) / 100;
      log.info({ teamId: row.team_id, from: current, to: adjusted, fpRate }, 'Threshold calibrated');
    }
  }

  // Save back
  const merged = { ...settings, team_thresholds: teamThresholds };
  await query(
    `UPDATE companies SET settings = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(merged), companyId],
  );

  log.info({ teamCount: Object.keys(teamThresholds).length }, 'Threshold calibration complete');
}
