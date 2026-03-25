import { z } from 'zod';
export declare const ActionTypeSchema: z.ZodEnum<["slack_reminder", "slack_summary", "slack_thread_reply", "jira_comment", "jira_create_task", "jira_template_suggest", "github_comment", "github_request_review", "github_reassign"]>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export declare const TargetSystemSchema: z.ZodEnum<["slack", "jira", "github"]>;
export type TargetSystem = z.infer<typeof TargetSystemSchema>;
export declare const RiskLevelSchema: z.ZodEnum<["low", "medium", "high"]>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export declare const ApprovalStatusSchema: z.ZodEnum<["pending", "approved", "rejected", "executed", "failed", "rolled_back"]>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export declare const ProposedActionSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    leak_instance_id: z.ZodOptional<z.ZodString>;
    action_type: z.ZodEnum<["slack_reminder", "slack_summary", "slack_thread_reply", "jira_comment", "jira_create_task", "jira_template_suggest", "github_comment", "github_request_review", "github_reassign"]>;
    target_system: z.ZodEnum<["slack", "jira", "github"]>;
    target_id: z.ZodString;
    preview_diff: z.ZodObject<{
        description: z.ZodString;
        before: z.ZodOptional<z.ZodString>;
        after: z.ZodString;
        structured: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        after: string;
        structured: Record<string, unknown>;
        before?: string | undefined;
    }, {
        description: string;
        after: string;
        before?: string | undefined;
        structured?: Record<string, unknown> | undefined;
    }>;
    risk_level: z.ZodEnum<["low", "medium", "high"]>;
    blast_radius: z.ZodOptional<z.ZodString>;
    approval_status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected", "executed", "failed", "rolled_back"]>>;
    requested_by: z.ZodOptional<z.ZodString>;
    approved_by: z.ZodOptional<z.ZodString>;
    approved_at: z.ZodOptional<z.ZodDate>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    action_type: "slack_reminder" | "slack_summary" | "slack_thread_reply" | "jira_comment" | "jira_create_task" | "jira_template_suggest" | "github_comment" | "github_request_review" | "github_reassign";
    target_system: "slack" | "jira" | "github";
    target_id: string;
    preview_diff: {
        description: string;
        after: string;
        structured: Record<string, unknown>;
        before?: string | undefined;
    };
    risk_level: "low" | "medium" | "high";
    approval_status: "pending" | "approved" | "rejected" | "executed" | "failed" | "rolled_back";
    leak_instance_id?: string | undefined;
    approved_by?: string | undefined;
    approved_at?: Date | undefined;
    blast_radius?: string | undefined;
    requested_by?: string | undefined;
}, {
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    action_type: "slack_reminder" | "slack_summary" | "slack_thread_reply" | "jira_comment" | "jira_create_task" | "jira_template_suggest" | "github_comment" | "github_request_review" | "github_reassign";
    target_system: "slack" | "jira" | "github";
    target_id: string;
    preview_diff: {
        description: string;
        after: string;
        before?: string | undefined;
        structured?: Record<string, unknown> | undefined;
    };
    risk_level: "low" | "medium" | "high";
    leak_instance_id?: string | undefined;
    approved_by?: string | undefined;
    approved_at?: Date | undefined;
    blast_radius?: string | undefined;
    approval_status?: "pending" | "approved" | "rejected" | "executed" | "failed" | "rolled_back" | undefined;
    requested_by?: string | undefined;
}>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export declare const CreateProposedActionSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    company_id: z.ZodString;
    leak_instance_id: z.ZodOptional<z.ZodString>;
    action_type: z.ZodEnum<["slack_reminder", "slack_summary", "slack_thread_reply", "jira_comment", "jira_create_task", "jira_template_suggest", "github_comment", "github_request_review", "github_reassign"]>;
    target_system: z.ZodEnum<["slack", "jira", "github"]>;
    target_id: z.ZodString;
    preview_diff: z.ZodObject<{
        description: z.ZodString;
        before: z.ZodOptional<z.ZodString>;
        after: z.ZodString;
        structured: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        after: string;
        structured: Record<string, unknown>;
        before?: string | undefined;
    }, {
        description: string;
        after: string;
        before?: string | undefined;
        structured?: Record<string, unknown> | undefined;
    }>;
    risk_level: z.ZodEnum<["low", "medium", "high"]>;
    blast_radius: z.ZodOptional<z.ZodString>;
    approval_status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected", "executed", "failed", "rolled_back"]>>;
    requested_by: z.ZodOptional<z.ZodString>;
    approved_by: z.ZodOptional<z.ZodString>;
    approved_at: z.ZodOptional<z.ZodDate>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "id" | "created_at" | "updated_at" | "approved_by" | "approved_at">, "strip", z.ZodTypeAny, {
    company_id: string;
    action_type: "slack_reminder" | "slack_summary" | "slack_thread_reply" | "jira_comment" | "jira_create_task" | "jira_template_suggest" | "github_comment" | "github_request_review" | "github_reassign";
    target_system: "slack" | "jira" | "github";
    target_id: string;
    preview_diff: {
        description: string;
        after: string;
        structured: Record<string, unknown>;
        before?: string | undefined;
    };
    risk_level: "low" | "medium" | "high";
    approval_status: "pending" | "approved" | "rejected" | "executed" | "failed" | "rolled_back";
    leak_instance_id?: string | undefined;
    blast_radius?: string | undefined;
    requested_by?: string | undefined;
}, {
    company_id: string;
    action_type: "slack_reminder" | "slack_summary" | "slack_thread_reply" | "jira_comment" | "jira_create_task" | "jira_template_suggest" | "github_comment" | "github_request_review" | "github_reassign";
    target_system: "slack" | "jira" | "github";
    target_id: string;
    preview_diff: {
        description: string;
        after: string;
        before?: string | undefined;
        structured?: Record<string, unknown> | undefined;
    };
    risk_level: "low" | "medium" | "high";
    leak_instance_id?: string | undefined;
    blast_radius?: string | undefined;
    approval_status?: "pending" | "approved" | "rejected" | "executed" | "failed" | "rolled_back" | undefined;
    requested_by?: string | undefined;
}>;
export type CreateProposedAction = z.infer<typeof CreateProposedActionSchema>;
