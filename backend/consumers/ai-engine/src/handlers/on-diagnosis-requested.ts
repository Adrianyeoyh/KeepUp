import type { EventPayloadMap, EventEnvelope } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { query } from '@flowguard/db';
import { validateDiagnosis } from '../services/ai-guardrails.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

type DiagnosisPayload = EventPayloadMap[typeof TOPICS.AI_DIAGNOSIS_REQ];

/**
 * Handler for ai.diagnosis.req topic.
 *
 * Runs AI diagnosis on a detected leak.
 * Migrated from apps/worker/src/services/ai-orchestrator.ts.
 */
export async function onDiagnosisRequested(
  payload: DiagnosisPayload,
  envelope: EventEnvelope<DiagnosisPayload>,
): Promise<void> {
  logger.info(
    { leakId: payload.leakId, leakType: payload.leakType, traceId: envelope.traceId },
    'AI diagnosis requested',
  );

  if (!config.LLM_API_KEY) {
    logger.warn('LLM API key not configured — skipping AI diagnosis');
    return;
  }

  try {
    // Build prompt from leak context
    const prompt = buildDiagnosisPrompt(payload);

    // Call LLM (provider-agnostic)
    const diagnosis = await callLLM(prompt);

    // Validate through guardrails
    const guardrailResult = validateDiagnosis(diagnosis);
    if (!guardrailResult.passed) {
      logger.warn({ violations: guardrailResult.violations }, 'AI diagnosis failed guardrails');
    }

    // Store diagnosis result
    await query(
      `UPDATE leak_instances SET ai_diagnosis = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({
        diagnosis: guardrailResult.sanitizedOutput || diagnosis,
        model: config.LLM_MODEL,
        provider: config.LLM_PROVIDER,
        generated_at: new Date().toISOString(),
        guardrails_passed: guardrailResult.passed,
      }), payload.leakId],
    );

    logger.info({ leakId: payload.leakId }, 'AI diagnosis stored');
  } catch (err) {
    logger.error({ err, leakId: payload.leakId }, 'AI diagnosis failed');
  }
}

function buildDiagnosisPrompt(payload: DiagnosisPayload): string {
  return `Analyze this detected engineering process leak and provide a diagnosis with recommended actions.

Leak Type: ${payload.leakType}
Metrics Context: ${JSON.stringify(payload.metricsContext)}
Evidence: ${JSON.stringify(payload.evidenceLinks)}

Provide:
1. Root cause analysis
2. Severity assessment
3. Recommended fix (actionable, specific)
4. Expected impact of fix`;
}

async function callLLM(prompt: string): Promise<string> {
  if (config.LLM_PROVIDER === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || '';
  }

  if (config.LLM_PROVIDER === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.LLM_API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || '';
  }

  throw new Error(`Unsupported LLM provider: ${config.LLM_PROVIDER}`);
}
