import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

const AIDiagnosisSchema = z.object({
  root_cause: z.string(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  fix_drafts: z.array(z.object({
    description: z.string(),
    action_type: z.string(),
    details: z.record(z.unknown()).default({}),
  })).default([]),
});

export type AIDiagnosis = z.infer<typeof AIDiagnosisSchema>;

type LeakForDiagnosis = {
  leak_type: string;
  severity: number;
  confidence: number;
  metrics_context: Record<string, unknown>;
  recommended_fix: Record<string, unknown>;
  evidence_links: Array<Record<string, unknown>>;
};

function fallbackDiagnosis(leak: LeakForDiagnosis): AIDiagnosis {
  const summary = typeof leak.recommended_fix.summary === 'string'
    ? leak.recommended_fix.summary
    : 'Follow the recommended low-risk remediation step.';

  return {
    root_cause: `Flow drift detected for ${leak.leak_type}`,
    confidence: Math.min(0.95, Math.max(0.5, leak.confidence)),
    explanation: `Detected ${leak.leak_type} with severity ${leak.severity}. Evidence indicates the metric moved above baseline and requires owner-driven remediation.`,
    fix_drafts: [
      {
        description: summary,
        action_type: String(leak.recommended_fix.action_type || 'propose_fix'),
        details: {
          source: 'deterministic-fallback',
        },
      },
    ],
  };
}

function extractJsonFromText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return '{}';
}

async function callOpenAI(leak: LeakForDiagnosis): Promise<AIDiagnosis | null> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are FlowGuard AI. Return strict JSON only with keys: root_cause, confidence, explanation, fix_drafts.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            leak,
            constraints: {
              max_fixes: 3,
              must_reference_evidence: true,
              low_blast_radius_only: true,
            },
          }),
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'OpenAI request failed');
    return null;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content as string | undefined;
  if (!content) {
    return null;
  }

  const parsedJson = JSON.parse(extractJsonFromText(content));
  const parsed = AIDiagnosisSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

async function callAnthropic(leak: LeakForDiagnosis): Promise<AIDiagnosis | null> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.LLM_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system: 'You are FlowGuard AI. Return strict JSON only with keys: root_cause, confidence, explanation, fix_drafts.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            leak,
            constraints: {
              max_fixes: 3,
              must_reference_evidence: true,
              low_blast_radius_only: true,
            },
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Anthropic request failed');
    return null;
  }

  const data = await response.json();
  const content = data.content?.find((entry: any) => entry.type === 'text')?.text as string | undefined;
  if (!content) {
    return null;
  }

  const parsedJson = JSON.parse(extractJsonFromText(content));
  const parsed = AIDiagnosisSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

export async function generateDiagnosis(leak: LeakForDiagnosis): Promise<AIDiagnosis> {
  if (!config.LLM_API_KEY) {
    return fallbackDiagnosis(leak);
  }

  try {
    const diagnosis = config.LLM_PROVIDER === 'anthropic'
      ? await callAnthropic(leak)
      : await callOpenAI(leak);

    return diagnosis || fallbackDiagnosis(leak);
  } catch (error) {
    logger.warn({ error }, 'AI orchestrator failed; using fallback diagnosis');
    return fallbackDiagnosis(leak);
  }
}
