import { z } from 'zod';
// ============================================
// ExecutedAction (immutable audit record)
// ============================================
export const ExecutionResultSchema = z.enum([
    'success',
    'partial_success',
    'failure',
    'rolled_back',
]);
export const ExecutedActionSchema = z.object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    proposed_action_id: z.string().uuid(),
    executed_at: z.coerce.date(),
    result: ExecutionResultSchema,
    // What was actually done (API response, created entity IDs, etc.)
    execution_details: z.record(z.unknown()).default({}),
    // Enough info to undo or mitigate the action
    rollback_info: z.object({
        can_rollback: z.boolean(),
        rollback_type: z.string().optional(), // delete_message, update_issue, etc.
        rollback_data: z.record(z.unknown()).default({}),
        rolled_back_at: z.coerce.date().optional(),
        rolled_back_by: z.string().optional(),
    }).default({ can_rollback: false }),
    // Full audit trail
    audit_log: z.array(z.object({
        timestamp: z.coerce.date(),
        action: z.string(),
        actor: z.string(),
        details: z.record(z.unknown()).default({}),
    })).default([]),
    created_at: z.coerce.date(),
});
export const CreateExecutedActionSchema = ExecutedActionSchema.omit({
    id: true,
    created_at: true,
});
//# sourceMappingURL=executed-action.js.map