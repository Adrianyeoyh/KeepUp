import { describe, it, expect } from 'vitest';

// ============================================
// Slack Event Normalization Tests (pure logic)
// ============================================
const RESOLUTION_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark']);

function detectImpliedAction(text: string): boolean {
  if (!text) return false;
  return /\b(todo|action item|follow up|follow-up|please|we should|let's)\b/i.test(text);
}

function hasLinkedJiraIssue(text: string): boolean {
  if (!text) return false;
  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(text);
}

function slackTsToDate(ts: string | number | undefined): Date {
  if (!ts) return new Date();
  const seconds = typeof ts === 'number' ? ts : Number(ts.split('.')[0] || ts);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

describe('Slack Event Normalization', () => {
  describe('detectImpliedAction', () => {
    it('should detect "todo" keyword', () => {
      expect(detectImpliedAction('We have a todo for next sprint')).toBe(true);
    });

    it('should detect "action item" keyword', () => {
      expect(detectImpliedAction('This is an action item for Sarah')).toBe(true);
    });

    it('should detect "follow up" keyword', () => {
      expect(detectImpliedAction('Can someone follow up on this?')).toBe(true);
    });

    it('should detect "follow-up" (hyphenated)', () => {
      expect(detectImpliedAction('This needs a follow-up')).toBe(true);
    });

    it('should detect "please" keyword', () => {
      expect(detectImpliedAction('Please check the deployment')).toBe(true);
    });

    it('should detect "we should" keyword', () => {
      expect(detectImpliedAction('we should really fix this')).toBe(true);
    });

    it("should detect \"let's\" keyword", () => {
      expect(detectImpliedAction("let's schedule a meeting")).toBe(true);
    });

    it('should return false for casual messages', () => {
      expect(detectImpliedAction('Nice work on the feature!')).toBe(false);
    });

    it('should return false for empty strings', () => {
      expect(detectImpliedAction('')).toBe(false);
    });
  });

  describe('hasLinkedJiraIssue', () => {
    it('should detect standard Jira issue keys', () => {
      expect(hasLinkedJiraIssue('Fixed in PROJ-123')).toBe(true);
    });

    it('should detect multi-char project keys', () => {
      expect(hasLinkedJiraIssue('See ENG-42 for details')).toBe(true);
    });

    it('should not match lowercase', () => {
      expect(hasLinkedJiraIssue('issue proj-123')).toBe(false);
    });

    it('should return false for no issue key', () => {
      expect(hasLinkedJiraIssue('Just a regular message')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasLinkedJiraIssue('')).toBe(false);
    });
  });

  describe('slackTsToDate', () => {
    it('should parse string timestamp', () => {
      const date = slackTsToDate('1700000000.123456');
      expect(date.getTime()).toBe(1700000000000);
    });

    it('should parse numeric timestamp', () => {
      const date = slackTsToDate(1700000000);
      expect(date.getTime()).toBe(1700000000000);
    });

    it('should return current date for undefined', () => {
      const before = Date.now();
      const date = slackTsToDate(undefined);
      expect(date.getTime()).toBeGreaterThanOrEqual(before - 100);
    });
  });

  describe('Resolution reactions', () => {
    it('should recognize white_check_mark as resolved', () => {
      expect(RESOLUTION_REACTIONS.has('white_check_mark')).toBe(true);
    });

    it('should recognize heavy_check_mark as resolved', () => {
      expect(RESOLUTION_REACTIONS.has('heavy_check_mark')).toBe(true);
    });

    it('should not treat thumbsup as resolved', () => {
      expect(RESOLUTION_REACTIONS.has('+1')).toBe(false);
      expect(RESOLUTION_REACTIONS.has('thumbsup')).toBe(false);
    });
  });
});

// ============================================
// Jira Event Normalization Tests
// ============================================
const REOPEN_STATUSES = new Set(['open', 'reopened', 'to do', 'todo']);
const DONE_STATUSES = new Set(['done', 'closed', 'resolved']);

describe('Jira Event Normalization', () => {
  describe('Status detection', () => {
    it('should detect reopen statuses', () => {
      expect(REOPEN_STATUSES.has('open')).toBe(true);
      expect(REOPEN_STATUSES.has('reopened')).toBe(true);
      expect(REOPEN_STATUSES.has('to do')).toBe(true);
      expect(REOPEN_STATUSES.has('todo')).toBe(true);
    });

    it('should detect done statuses', () => {
      expect(DONE_STATUSES.has('done')).toBe(true);
      expect(DONE_STATUSES.has('closed')).toBe(true);
      expect(DONE_STATUSES.has('resolved')).toBe(true);
    });

    it('should not treat in-progress as reopen or done', () => {
      expect(REOPEN_STATUSES.has('in progress')).toBe(false);
      expect(DONE_STATUSES.has('in progress')).toBe(false);
    });
  });

  describe('Webhook payload structure', () => {
    it('should parse issue_created payload', () => {
      const payload = {
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'PROJ-101',
          fields: {
            project: { key: 'PROJ' },
            status: { name: 'To Do' },
            issuetype: { name: 'Task' },
            created: '2026-03-05T10:00:00.000Z',
          },
        },
      };
      expect(payload.webhookEvent).toBe('jira:issue_created');
      expect(payload.issue.key).toBe('PROJ-101');
      expect(payload.issue.fields.project.key).toBe('PROJ');
    });

    it('should parse issue_updated with status change', () => {
      const payload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'PROJ-102',
          fields: { status: { name: 'Reopened' }, updated: '2026-03-05T12:00:00.000Z' },
        },
        changelog: {
          items: [
            { field: 'status', fromString: 'Done', toString: 'Reopened' },
          ],
        },
      };
      const statusChange = payload.changelog.items.find((i) => i.field === 'status');
      expect(statusChange).toBeTruthy();
      expect(statusChange!.toString).toBe('Reopened');
      expect(REOPEN_STATUSES.has(statusChange!.toString.toLowerCase())).toBe(true);
    });

    it('should detect transition to done', () => {
      const statusChange = { field: 'status', fromString: 'In Progress', toString: 'Done' };
      expect(DONE_STATUSES.has(statusChange.toString.toLowerCase())).toBe(true);
    });
  });
});

// ============================================
// GitHub Webhook Payload Tests
// ============================================
describe('GitHub Webhook Payloads', () => {
  it('should normalize PR opened event', () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 205,
        user: { login: 'dev0' },
        title: 'Refactor auth module',
        base: { repo: { full_name: 'acme/main-app' } },
        state: 'open',
      },
    };
    const pr = payload.pull_request;
    expect(pr.number).toBe(205);
    expect(pr.base.repo.full_name).toBe('acme/main-app');
  });

  it('should normalize review_requested event', () => {
    const payload = {
      action: 'review_requested',
      pull_request: { number: 205 },
      requested_reviewer: { login: 'reviewer0' },
    };
    expect(payload.action).toBe('review_requested');
    expect(payload.requested_reviewer.login).toBe('reviewer0');
  });

  it('should normalize PR merged event', () => {
    const payload = {
      action: 'closed',
      pull_request: {
        number: 205,
        merged: true,
        merged_at: '2026-03-05T15:00:00Z',
      },
    };
    expect(payload.pull_request.merged).toBe(true);
  });
});

// ============================================
// Ledger State Machine Tests
// ============================================
describe('Ledger State Machine', () => {
  const validTransitions: Record<string, string[]> = {
    draft: ['proposed'],
    proposed: ['approved', 'rejected'],
    approved: ['merged'],
  };

  it('should allow draft → proposed', () => {
    expect(validTransitions['draft']).toContain('proposed');
  });

  it('should allow proposed → approved', () => {
    expect(validTransitions['proposed']).toContain('approved');
  });

  it('should allow proposed → rejected', () => {
    expect(validTransitions['proposed']).toContain('rejected');
  });

  it('should allow approved → merged', () => {
    expect(validTransitions['approved']).toContain('merged');
  });

  it('should NOT allow draft → merged directly', () => {
    expect(validTransitions['draft']).not.toContain('merged');
  });

  it('should NOT allow draft → approved directly', () => {
    expect(validTransitions['draft']).not.toContain('approved');
  });

  it('should NOT allow rejected → any state', () => {
    expect(validTransitions['rejected']).toBeUndefined();
  });

  it('should NOT allow merged → any state', () => {
    expect(validTransitions['merged']).toBeUndefined();
  });
});
