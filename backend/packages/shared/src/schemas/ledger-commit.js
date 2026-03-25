import { z } from 'zod';
import { EvidenceLinkSchema } from './event.js';
// ============================================
// LedgerCommit (git-style memory anchor)
// ============================================
export const CommitTypeSchema = z.enum([
    'decision', // Decision Record
    'action', // Action Item
    'policy', // Policy change
    'template_change', // Template/workflow modification
]);
export const CommitStatusSchema = z.enum([
    'draft', // AI-generated, not yet proposed
    'proposed', // Presented to user for approval
    'approved', // User approved
    'merged', // Merged into mainline (canonical truth)
    'rejected', // User rejected
]);
export const LedgerCommitSchema = z.object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    commit_type: CommitTypeSchema,
    title: z.string().min(1),
    summary: z.string(),
    rationale: z.string().optional(),
    dri: z.string().optional(), // Directly Responsible Individual
    status: CommitStatusSchema.default('draft'),
    branch_name: z.string().default('main'),
    parent_commit_id: z.string().uuid().optional(),
    // Evidence: links to originating Slack thread, Jira issue, PR
    evidence_links: z.array(EvidenceLinkSchema).default([]),
    // Tags for categorization
    tags: z.array(z.string()).default([]),
    // Related leak instance (if any)
    leak_instance_id: z.string().uuid().optional(),
    // Who created / approved
    created_by: z.string().optional(), // user ID (Slack/system)
    approved_by: z.string().optional(),
    approved_at: z.coerce.date().optional(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
});
export const CreateLedgerCommitSchema = LedgerCommitSchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
    approved_at: true,
    approved_by: true,
});
//# sourceMappingURL=ledger-commit.js.map