import { z } from 'zod';
export declare const LeakTypeSchema: z.ZodEnum<["decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"]>;
export type LeakType = z.infer<typeof LeakTypeSchema>;
export declare const LeakSeveritySchema: z.ZodNumber;
export declare const LeakConfidenceSchema: z.ZodNumber;
export declare const LeakStatusSchema: z.ZodEnum<["detected", "delivered", "actioned", "snoozed", "suppressed", "resolved"]>;
export type LeakStatus = z.infer<typeof LeakStatusSchema>;
export declare const LeakInstanceSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    leak_type: z.ZodEnum<["decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"]>;
    severity: z.ZodNumber;
    confidence: z.ZodNumber;
    status: z.ZodDefault<z.ZodEnum<["detected", "delivered", "actioned", "snoozed", "suppressed", "resolved"]>>;
    detected_at: z.ZodDate;
    evidence_links: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<["slack", "jira", "github", "zendesk", "system"]>;
        entity_type: z.ZodString;
        entity_id: z.ZodString;
        url: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }, {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }>, "many">;
    metrics_context: z.ZodObject<{
        current_value: z.ZodNumber;
        baseline_value: z.ZodNumber;
        metric_name: z.ZodString;
        delta_percentage: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    }, {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    }>;
    recommended_fix: z.ZodObject<{
        summary: z.ZodString;
        action_type: z.ZodString;
        details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        summary: string;
        action_type: string;
        details: Record<string, unknown>;
    }, {
        summary: string;
        action_type: string;
        details?: Record<string, unknown> | undefined;
    }>;
    cost_estimate_hours_per_week: z.ZodOptional<z.ZodNumber>;
    ai_diagnosis: z.ZodOptional<z.ZodObject<{
        root_cause: z.ZodString;
        confidence: z.ZodNumber;
        explanation: z.ZodString;
        fix_drafts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            description: z.ZodString;
            action_type: z.ZodString;
            details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strip", z.ZodTypeAny, {
            action_type: string;
            details: Record<string, unknown>;
            description: string;
        }, {
            action_type: string;
            description: string;
            details?: Record<string, unknown> | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts: {
            action_type: string;
            details: Record<string, unknown>;
            description: string;
        }[];
    }, {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts?: {
            action_type: string;
            description: string;
            details?: Record<string, unknown> | undefined;
        }[] | undefined;
    }>>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "detected" | "delivered" | "actioned" | "snoozed" | "suppressed" | "resolved";
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    detected_at: Date;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    metrics_context: {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    };
    recommended_fix: {
        summary: string;
        action_type: string;
        details: Record<string, unknown>;
    };
    cost_estimate_hours_per_week?: number | undefined;
    ai_diagnosis?: {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts: {
            action_type: string;
            details: Record<string, unknown>;
            description: string;
        }[];
    } | undefined;
}, {
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    detected_at: Date;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    metrics_context: {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    };
    recommended_fix: {
        summary: string;
        action_type: string;
        details?: Record<string, unknown> | undefined;
    };
    status?: "detected" | "delivered" | "actioned" | "snoozed" | "suppressed" | "resolved" | undefined;
    cost_estimate_hours_per_week?: number | undefined;
    ai_diagnosis?: {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts?: {
            action_type: string;
            description: string;
            details?: Record<string, unknown> | undefined;
        }[] | undefined;
    } | undefined;
}>;
export type LeakInstance = z.infer<typeof LeakInstanceSchema>;
export declare const CreateLeakInstanceSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    company_id: z.ZodString;
    leak_type: z.ZodEnum<["decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"]>;
    severity: z.ZodNumber;
    confidence: z.ZodNumber;
    status: z.ZodDefault<z.ZodEnum<["detected", "delivered", "actioned", "snoozed", "suppressed", "resolved"]>>;
    detected_at: z.ZodDate;
    evidence_links: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<["slack", "jira", "github", "zendesk", "system"]>;
        entity_type: z.ZodString;
        entity_id: z.ZodString;
        url: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }, {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }>, "many">;
    metrics_context: z.ZodObject<{
        current_value: z.ZodNumber;
        baseline_value: z.ZodNumber;
        metric_name: z.ZodString;
        delta_percentage: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    }, {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    }>;
    recommended_fix: z.ZodObject<{
        summary: z.ZodString;
        action_type: z.ZodString;
        details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        summary: string;
        action_type: string;
        details: Record<string, unknown>;
    }, {
        summary: string;
        action_type: string;
        details?: Record<string, unknown> | undefined;
    }>;
    cost_estimate_hours_per_week: z.ZodOptional<z.ZodNumber>;
    ai_diagnosis: z.ZodOptional<z.ZodObject<{
        root_cause: z.ZodString;
        confidence: z.ZodNumber;
        explanation: z.ZodString;
        fix_drafts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            description: z.ZodString;
            action_type: z.ZodString;
            details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strip", z.ZodTypeAny, {
            action_type: string;
            details: Record<string, unknown>;
            description: string;
        }, {
            action_type: string;
            description: string;
            details?: Record<string, unknown> | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts: {
            action_type: string;
            details: Record<string, unknown>;
            description: string;
        }[];
    }, {
        confidence: number;
        root_cause: string;
        explanation: string;
        fix_drafts?: {
            action_type: string;
            description: string;
            details?: Record<string, unknown> | undefined;
        }[] | undefined;
    }>>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "id" | "created_at" | "updated_at" | "ai_diagnosis">, "strip", z.ZodTypeAny, {
    status: "detected" | "delivered" | "actioned" | "snoozed" | "suppressed" | "resolved";
    company_id: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    detected_at: Date;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    metrics_context: {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    };
    recommended_fix: {
        summary: string;
        action_type: string;
        details: Record<string, unknown>;
    };
    cost_estimate_hours_per_week?: number | undefined;
}, {
    company_id: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    detected_at: Date;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    metrics_context: {
        metric_name: string;
        baseline_value: number;
        current_value: number;
        delta_percentage: number;
    };
    recommended_fix: {
        summary: string;
        action_type: string;
        details?: Record<string, unknown> | undefined;
    };
    status?: "detected" | "delivered" | "actioned" | "snoozed" | "suppressed" | "resolved" | undefined;
    cost_estimate_hours_per_week?: number | undefined;
}>;
export type CreateLeakInstance = z.infer<typeof CreateLeakInstanceSchema>;
