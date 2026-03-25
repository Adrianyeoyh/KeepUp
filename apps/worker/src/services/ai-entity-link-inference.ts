import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * AI Entity-Link Inference
 *
 * Uses LLM to detect implicit cross-tool connections that regex can't catch.
 * For example: a Slack message says "the auth PR" → infers link to acme/api#142.
 * Creates entity_links with confidence < 1.0 and detected_by = 'ai'.
 */

interface UnlinkedEvent {
  id: string;
  company_id: string;
  source: string;
  entity_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
}

interface InferredLink {
  source_provider: string;
  source_entity_type: string;
  source_entity_id: string;
  target_provider: string;
  target_entity_type: string;
  target_entity_id: string;
  link_type: string;
  confidence: number;
  reasoning: string;
}

async function callLLMForLinks(events: UnlinkedEvent[], knownEntities: string[]): Promise<InferredLink[]> {
  if (!config.LLM_API_KEY) return [];

  const systemMsg = `You are FlowGuard AI. Given Slack/Jira/GitHub events and a list of known entities, infer plausible cross-tool entity links that regex matching would miss. Return strict JSON array of links. Each link has: source_provider, source_entity_type, source_entity_id, target_provider, target_entity_type, target_entity_id, link_type (mentions|fixes|discussed_in|reviewed_in), confidence (0-1), reasoning.`;

  const prompt = JSON.stringify({
    events: events.map((e) => ({
      source: e.source,
      entity_id: e.entity_id,
      event_type: e.event_type,
      text: (e.metadata as any)?.text?.substring(0, 500) || '',
      title: (e.metadata as any)?.title || (e.metadata as any)?.pr_title || '',
    })),
    known_entities: knownEntities.slice(0, 50),
    output: 'JSON array of InferredLink objects. Only return links with confidence >= 0.5.',
  });

  try {
    const body = config.LLM_PROVIDER === 'anthropic'
      ? {
          model: config.LLM_MODEL,
          max_tokens: 600,
          temperature: 0.1,
          system: systemMsg,
          messages: [{ role: 'user', content: prompt }],
        }
      : {
          model: config.LLM_MODEL,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        };

    const url = config.LLM_PROVIDER === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions';

    const headers: Record<string, string> = config.LLM_PROVIDER === 'anthropic'
      ? { 'x-api-key': config.LLM_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${config.LLM_API_KEY}`, 'Content-Type': 'application/json' };

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) return [];

    const data = await response.json();
    const content = config.LLM_PROVIDER === 'anthropic'
      ? data.content?.find((e: any) => e.type === 'text')?.text
      : data.choices?.[0]?.message?.content;

    if (!content) return [];

    const trimmed = content.trim();
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');

    let parsed: unknown;
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      parsed = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } else {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const obj = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        parsed = obj.links || obj.inferred_links || [];
      } else {
        return [];
      }
    }

    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l: any) =>
      l.source_provider && l.target_provider && l.confidence >= 0.5,
    ) as InferredLink[];
  } catch (err) {
    logger.warn({ err }, 'LLM entity-link inference failed');
    return [];
  }
}

export async function runAIEntityLinkInference(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'ai-entity-link-inference' });

  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`, [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const enabledFeatures = (settings.ai_enabled_features as string[]) || [];

  if (enabledFeatures.length > 0 && !enabledFeatures.includes('entity_link_inference')) {
    log.debug('AI entity-link inference disabled');
    return;
  }

  const aiBudget = (settings.ai_budget_per_day as number) || 10;
  const usageResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM entity_links
     WHERE company_id = $1 AND detected_by = 'ai' AND created_at::date = CURRENT_DATE`,
    [companyId],
  );
  if (parseInt(usageResult.rows[0]?.count || '0', 10) >= aiBudget * 3) {
    log.info('AI entity-link budget exhausted today');
    return;
  }

  // Find recent events that have no entity links
  const eventsResult = await query<UnlinkedEvent>(
    `SELECT e.id, e.company_id, e.source, e.entity_id, e.event_type, e.metadata
     FROM events e
     WHERE e.company_id = $1
       AND e.created_at > NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM entity_links el
         WHERE el.company_id = e.company_id
           AND (el.source_entity_id = e.entity_id OR el.target_entity_id = e.entity_id)
       )
     ORDER BY e.created_at DESC
     LIMIT 20`,
    [companyId],
  );

  if (eventsResult.rows.length === 0) {
    log.debug('No unlinked events to infer');
    return;
  }

  // Get known entities for context
  const knownResult = await query<{ entity_id: string }>(
    `SELECT DISTINCT entity_id FROM events
     WHERE company_id = $1 AND created_at > NOW() - INTERVAL '7 days'
     ORDER BY entity_id
     LIMIT 100`,
    [companyId],
  );
  const knownEntities = knownResult.rows.map((r) => r.entity_id);

  const inferred = await callLLMForLinks(eventsResult.rows, knownEntities);

  let insertedCount = 0;
  for (const link of inferred) {
    try {
      await query(
        `INSERT INTO entity_links (
           company_id, source_provider, source_entity_type, source_entity_id,
           target_provider, target_entity_type, target_entity_id,
           link_type, confidence, detected_by, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai', $10)
         ON CONFLICT DO NOTHING`,
        [
          companyId,
          link.source_provider, link.source_entity_type, link.source_entity_id,
          link.target_provider, link.target_entity_type, link.target_entity_id,
          link.link_type,
          link.confidence,
          JSON.stringify({ reasoning: link.reasoning, inferred_at: new Date().toISOString() }),
        ],
      );
      insertedCount++;
    } catch (err) {
      log.warn({ err, link }, 'Failed to insert inferred entity link');
    }
  }

  log.info({ inferred: inferred.length, inserted: insertedCount }, 'AI entity-link inference complete');
}
