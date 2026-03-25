import { z } from 'zod';
// ============================================
// ProposedAction (remediation draft with approval)
// ============================================
export const ActionTypeSchema = z.enum([
    'slack_reminder', // Post reminder message in Slack
    'slack_summary', // Post summary + DRI request
    'slack_thread_reply', // Reply to a thread
    'jira_comment', // Add comment to Jira issue
    'jira_create_task', // Create follow-up Jira task
    'jira_template_suggest', // Suggest template/AC changes
    'github_comment', // Comment on PR
    'github_request_review', // Request review / ping reviewer
    'github_reassign', // Suggest reassignment
]);
export const TargetSystemSchema = z.enum([
    'slack',
    'jira',
    'github',
]);
export const RiskLevelSchema = z.enum([
    'low', // comment/message only — easily reversible
    'medium', // creates artifacts (tasks, tickets)
    'high', // modifies templates/workflows
]);
export const ApprovalStatusSchema = z.enum([
    'pending', // awaiting approval
    'approved', // approved, ready to execute
    'rejected', // rejected by user
    'executed', // successfully executed
    'failed', // execution failed
    'rolled_back', // rolled back after execution
]);
export const ProposedActionSchema = z.object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    leak_instance_id: z.string().uuid().optional(),
    action_type: ActionTypeSchema,
    target_system: TargetSystemSchema,
    target_id: z.string(), // channel_id, issue key, PR number, etc.
    // Human-readable preview of what will happen
    preview_diff: z.object({
        description: z.string(),
        before: z.string().optional(),
        after: z.string(),
        structured: z.record(z.unknown()).default({}),
    }),
    risk_level: RiskLevelSchema,
    blast_radius: z.string().optional(), // "channel:#engineering", "project:PROJ", etc.
    approval_status: ApprovalStatusSchema.default('pending'),
    requested_by: z.string().optional(), // system or user ID
    approved_by: z.string().optional(),
    approved_at: z.coerce.date().optional(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
});
export const CreateProposedActionSchema = ProposedActionSchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
    approved_at: true,
    approved_by: true,
});
//# sourceMappingURL=proposed-action.js.map