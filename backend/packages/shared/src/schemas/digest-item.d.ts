import { z } from 'zod';
export declare const DigestItemSchema: z.ZodObject<{
    leak_instance_id: z.ZodString;
    rank: z.ZodNumber;
    leak_type: z.ZodEnum<["decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"]>;
    severity: z.ZodNumber;
    confidence: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodString;
    cost_estimate: z.ZodOptional<z.ZodString>;
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
    baseline_comparison: z.ZodString;
    recommended_fix_summary: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        action_id: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<["create_decision_commit", "create_action_commit", "propose_fix", "approve_fix", "snooze"]>;
    }, "strip", z.ZodTypeAny, {
        type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
        action_id: string;
        label: string;
    }, {
        type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
        action_id: string;
        label: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    title: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    description: string;
    leak_instance_id: string;
    rank: number;
    baseline_comparison: string;
    recommended_fix_summary: string;
    actions: {
        type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
        action_id: string;
        label: string;
    }[];
    cost_estimate?: string | undefined;
}, {
    title: string;
    leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
    severity: number;
    confidence: number;
    evidence_links: {
        url: string;
        provider: "slack" | "jira" | "github" | "zendesk" | "system";
        entity_type: string;
        entity_id: string;
        title?: string | undefined;
    }[];
    description: string;
    leak_instance_id: string;
    rank: number;
    baseline_comparison: string;
    recommended_fix_summary: string;
    actions: {
        type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
        action_id: string;
        label: string;
    }[];
    cost_estimate?: string | undefined;
}>;
export type DigestItem = z.infer<typeof DigestItemSchema>;
export declare const DigestSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    date: z.ZodDate;
    items: z.ZodArray<z.ZodObject<{
        leak_instance_id: z.ZodString;
        rank: z.ZodNumber;
        leak_type: z.ZodEnum<["decision_drift", "unlogged_action_items", "reopen_bounce_spike", "cycle_time_drift", "pr_review_bottleneck"]>;
        severity: z.ZodNumber;
        confidence: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
        cost_estimate: z.ZodOptional<z.ZodString>;
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
        baseline_comparison: z.ZodString;
        recommended_fix_summary: z.ZodString;
        actions: z.ZodArray<z.ZodObject<{
            action_id: z.ZodString;
            label: z.ZodString;
            type: z.ZodEnum<["create_decision_commit", "create_action_commit", "propose_fix", "approve_fix", "snooze"]>;
        }, "strip", z.ZodTypeAny, {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }, {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        title: string;
        leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
        severity: number;
        confidence: number;
        evidence_links: {
            url: string;
            provider: "slack" | "jira" | "github" | "zendesk" | "system";
            entity_type: string;
            entity_id: string;
            title?: string | undefined;
        }[];
        description: string;
        leak_instance_id: string;
        rank: number;
        baseline_comparison: string;
        recommended_fix_summary: string;
        actions: {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }[];
        cost_estimate?: string | undefined;
    }, {
        title: string;
        leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
        severity: number;
        confidence: number;
        evidence_links: {
            url: string;
            provider: "slack" | "jira" | "github" | "zendesk" | "system";
            entity_type: string;
            entity_id: string;
            title?: string | undefined;
        }[];
        description: string;
        leak_instance_id: string;
        rank: number;
        baseline_comparison: string;
        recommended_fix_summary: string;
        actions: {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }[];
        cost_estimate?: string | undefined;
    }>, "many">;
    delivered_at: z.ZodOptional<z.ZodDate>;
    delivered_to: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    created_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: Date;
    company_id: string;
    date: Date;
    items: {
        title: string;
        leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
        severity: number;
        confidence: number;
        evidence_links: {
            url: string;
            provider: "slack" | "jira" | "github" | "zendesk" | "system";
            entity_type: string;
            entity_id: string;
            title?: string | undefined;
        }[];
        description: string;
        leak_instance_id: string;
        rank: number;
        baseline_comparison: string;
        recommended_fix_summary: string;
        actions: {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }[];
        cost_estimate?: string | undefined;
    }[];
    delivered_to: string[];
    delivered_at?: Date | undefined;
}, {
    id: string;
    created_at: Date;
    company_id: string;
    date: Date;
    items: {
        title: string;
        leak_type: "decision_drift" | "unlogged_action_items" | "reopen_bounce_spike" | "cycle_time_drift" | "pr_review_bottleneck";
        severity: number;
        confidence: number;
        evidence_links: {
            url: string;
            provider: "slack" | "jira" | "github" | "zendesk" | "system";
            entity_type: string;
            entity_id: string;
            title?: string | undefined;
        }[];
        description: string;
        leak_instance_id: string;
        rank: number;
        baseline_comparison: string;
        recommended_fix_summary: string;
        actions: {
            type: "create_decision_commit" | "create_action_commit" | "propose_fix" | "approve_fix" | "snooze";
            action_id: string;
            label: string;
        }[];
        cost_estimate?: string | undefined;
    }[];
    delivered_at?: Date | undefined;
    delivered_to?: string[] | undefined;
}>;
export type Digest = z.infer<typeof DigestSchema>;
