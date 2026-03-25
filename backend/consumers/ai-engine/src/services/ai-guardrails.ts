import { logger } from '../logger.js';

/**
 * AI Guardrails — Validation layer for all AI outputs.
 *
 * Placeholder for Phase 4 implementation.
 * Ensures AI-generated recommendations pass safety and quality checks
 * before being surfaced to users.
 */

export interface GuardrailResult {
  passed: boolean;
  violations: string[];
  sanitizedOutput?: string;
}

/**
 * Validate AI diagnosis output.
 * Checks for:
 * - Reasonable length
 * - No hallucinated data references
 * - Actionable recommendations
 */
export function validateDiagnosis(output: string): GuardrailResult {
  const violations: string[] = [];

  if (!output || output.length < 10) {
    violations.push('Diagnosis output too short');
  }

  if (output.length > 5000) {
    violations.push('Diagnosis output exceeds maximum length');
  }

  return {
    passed: violations.length === 0,
    violations,
    sanitizedOutput: output.slice(0, 5000),
  };
}

/**
 * Validate AI recommendation draft.
 */
export function validateDraft(output: string): GuardrailResult {
  const violations: string[] = [];

  if (!output || output.length < 10) {
    violations.push('Draft output too short');
  }

  return {
    passed: violations.length === 0,
    violations,
    sanitizedOutput: output,
  };
}
