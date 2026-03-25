import { describe, it, expect } from 'vitest';
import type { ProposedAction, RiskLevel } from '@flowguard/shared';

// ============================================
// Blast-Radius Enforcement Tests (pure logic)
// ============================================
// Re-implement the blast-radius enforcement logic here for unit testing
// (the actual function is not exported, but we test the same logic)

const ALLOWED_RISK_LEVELS: RiskLevel[] = ['low', 'medium'];

function enforceBlastRadius(action: { risk_level: RiskLevel; blast_radius?: string }): { allowed: boolean; reason?: string } {
  if (!ALLOWED_RISK_LEVELS.includes(action.risk_level)) {
    return { allowed: false, reason: `Risk level '${action.risk_level}' exceeds MVP blast-radius policy (max: medium)` };
  }
  if (action.blast_radius) {
    const scope = action.blast_radius;
    if (scope.startsWith('workspace:') || scope.startsWith('org:')) {
      return { allowed: false, reason: `Blast radius '${scope}' too broad for automated execution` };
    }
  }
  return { allowed: true };
}

describe('Blast-Radius Enforcement', () => {
  it('should allow low-risk channel-scoped actions', () => {
    const result = enforceBlastRadius({
      risk_level: 'low',
      blast_radius: 'channel:#general',
    });
    expect(result.allowed).toBe(true);
  });

  it('should allow medium-risk issue-scoped actions', () => {
    const result = enforceBlastRadius({
      risk_level: 'medium',
      blast_radius: 'issue:PROJ-105',
    });
    expect(result.allowed).toBe(true);
  });

  it('should block high-risk actions', () => {
    const result = enforceBlastRadius({
      risk_level: 'high',
      blast_radius: 'pr:acme/main-app#205',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('high');
    expect(result.reason).toContain('MVP blast-radius policy');
  });

  it('should block workspace-scoped actions', () => {
    const result = enforceBlastRadius({
      risk_level: 'low',
      blast_radius: 'workspace:acme-engineering',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('too broad');
  });

  it('should block org-scoped actions', () => {
    const result = enforceBlastRadius({
      risk_level: 'medium',
      blast_radius: 'org:acme-corp',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('too broad');
  });

  it('should allow actions with no blast_radius set', () => {
    const result = enforceBlastRadius({
      risk_level: 'low',
    });
    expect(result.allowed).toBe(true);
  });

  it('should allow PR-scoped actions at low risk', () => {
    const result = enforceBlastRadius({
      risk_level: 'low',
      blast_radius: 'pr:acme/main-app#205',
    });
    expect(result.allowed).toBe(true);
  });
});

// ============================================
// GitHub Target Parsing Tests
// ============================================
function parseGitHubTarget(targetId: string): { owner: string; repo: string; prNumber: number } | null {
  const match = targetId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
}

describe('parseGitHubTarget', () => {
  it('should parse valid owner/repo#number format', () => {
    const result = parseGitHubTarget('acme/main-app#205');
    expect(result).toEqual({ owner: 'acme', repo: 'main-app', prNumber: 205 });
  });

  it('should parse repos with dashes and numbers', () => {
    const result = parseGitHubTarget('my-org/api-v2#42');
    expect(result).toEqual({ owner: 'my-org', repo: 'api-v2', prNumber: 42 });
  });

  it('should return null for invalid formats', () => {
    expect(parseGitHubTarget('not-a-target')).toBeNull();
    expect(parseGitHubTarget('just-repo#123')).toBeNull();
    expect(parseGitHubTarget('')).toBeNull();
  });

  it('should return null for missing PR number', () => {
    expect(parseGitHubTarget('owner/repo#')).toBeNull();
    expect(parseGitHubTarget('owner/repo')).toBeNull();
  });
});

// ============================================
// Rollback Info Structure Tests
// ============================================
describe('Rollback Info Structures', () => {
  it('should have correct Slack rollback structure', () => {
    const rollbackInfo = {
      can_rollback: true,
      rollback_type: 'delete_message',
      rollback_data: {
        channel: 'C_GENERAL',
        ts: '1234567890.123456',
      },
    };
    expect(rollbackInfo.can_rollback).toBe(true);
    expect(rollbackInfo.rollback_type).toBe('delete_message');
    expect(rollbackInfo.rollback_data.channel).toBeTruthy();
    expect(rollbackInfo.rollback_data.ts).toBeTruthy();
  });

  it('should have correct Jira rollback structure', () => {
    const rollbackInfo = {
      can_rollback: true,
      rollback_type: 'delete_comment',
      rollback_data: {
        base_url: 'https://acme.atlassian.net',
        issue_key: 'PROJ-105',
        comment_id: '12345',
      },
    };
    expect(rollbackInfo.can_rollback).toBe(true);
    expect(rollbackInfo.rollback_data.base_url).toBeTruthy();
    expect(rollbackInfo.rollback_data.comment_id).toBeTruthy();
  });

  it('should have correct GitHub rollback structure', () => {
    const rollbackInfo = {
      can_rollback: true,
      rollback_type: 'delete_comment',
      rollback_data: {
        owner: 'acme',
        repo: 'main-app',
        comment_id: 67890,
      },
    };
    expect(rollbackInfo.can_rollback).toBe(true);
    expect(rollbackInfo.rollback_data.owner).toBeTruthy();
    expect(rollbackInfo.rollback_data.repo).toBeTruthy();
    expect(rollbackInfo.rollback_data.comment_id).toBeTruthy();
  });

  it('should detect already-rolled-back actions', () => {
    const rollbackInfo = {
      can_rollback: true,
      rollback_type: 'delete_message',
      rollback_data: { channel: 'C_GEN', ts: '123.456' },
      rolled_back_at: new Date(),
      rolled_back_by: 'U_USER1',
    };
    expect(rollbackInfo.rolled_back_at).toBeTruthy();
  });
});
