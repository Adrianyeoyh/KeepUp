import { z } from 'zod';
export declare const EventSourceSchema: z.ZodEnum<["slack", "jira", "github", "zendesk", "system"]>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export declare const EventTypeSchema: z.ZodEnum<["slack.message", "slack.thread_reply", "slack.reaction_added", "slack.reaction_removed", "slack.channel_created", "slack.thread_resolved", "jira.issue_created", "jira.issue_updated", "jira.issue_transitioned", "jira.issue_reopened", "jira.comment_added", "github.pr_opened", "github.pr_updated", "github.pr_merged", "github.pr_closed", "github.review_requested", "github.review_submitted", "github.comment_added", "system.digest_sent", "system.action_executed"]>;
export type EventType = z.infer<typeof EventTypeSchema>;
export declare const EvidenceLinkSchema: z.ZodObject<{
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
}>;
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;
export declare const EventSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    source: z.ZodEnum<["slack", "jira", "github", "zendesk", "system"]>;
    entity_id: z.ZodString;
    event_type: z.ZodEnum<["slack.message", "slack.thread_reply", "slack.reaction_added", "slack.reaction_removed", "slack.channel_created", "slack.thread_resolved", "jira.issue_created", "jira.issue_updated", "jira.issue_transitioned", "jira.issue_reopened", "jira.comment_added", "github.pr_opened", "github.pr_updated", "github.pr_merged", "github.pr_closed", "github.review_requested", "github.review_submitted", "github.comment_added", "system.digest_sent", "system.action_executed"]>;
    timestamp: z.ZodDate;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    provider_event_id: z.ZodString;
    created_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: Date;
    company_id: string;
    entity_id: string;
    source: "slack" | "jira" | "github" | "zendesk" | "system";
    event_type: "slack.message" | "slack.thread_reply" | "slack.reaction_added" | "slack.reaction_removed" | "slack.channel_created" | "slack.thread_resolved" | "jira.issue_created" | "jira.issue_updated" | "jira.issue_transitioned" | "jira.issue_reopened" | "jira.comment_added" | "github.pr_opened" | "github.pr_updated" | "github.pr_merged" | "github.pr_closed" | "github.review_requested" | "github.review_submitted" | "github.comment_added" | "system.digest_sent" | "system.action_executed";
    timestamp: Date;
    metadata: Record<string, unknown>;
    provider_event_id: string;
}, {
    id: string;
    created_at: Date;
    company_id: string;
    entity_id: string;
    source: "slack" | "jira" | "github" | "zendesk" | "system";
    event_type: "slack.message" | "slack.thread_reply" | "slack.reaction_added" | "slack.reaction_removed" | "slack.channel_created" | "slack.thread_resolved" | "jira.issue_created" | "jira.issue_updated" | "jira.issue_transitioned" | "jira.issue_reopened" | "jira.comment_added" | "github.pr_opened" | "github.pr_updated" | "github.pr_merged" | "github.pr_closed" | "github.review_requested" | "github.review_submitted" | "github.comment_added" | "system.digest_sent" | "system.action_executed";
    timestamp: Date;
    provider_event_id: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type Event = z.infer<typeof EventSchema>;
export declare const CreateEventSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    company_id: z.ZodString;
    source: z.ZodEnum<["slack", "jira", "github", "zendesk", "system"]>;
    entity_id: z.ZodString;
    event_type: z.ZodEnum<["slack.message", "slack.thread_reply", "slack.reaction_added", "slack.reaction_removed", "slack.channel_created", "slack.thread_resolved", "jira.issue_created", "jira.issue_updated", "jira.issue_transitioned", "jira.issue_reopened", "jira.comment_added", "github.pr_opened", "github.pr_updated", "github.pr_merged", "github.pr_closed", "github.review_requested", "github.review_submitted", "github.comment_added", "system.digest_sent", "system.action_executed"]>;
    timestamp: z.ZodDate;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    provider_event_id: z.ZodString;
    created_at: z.ZodDate;
}, "id" | "created_at">, "strip", z.ZodTypeAny, {
    company_id: string;
    entity_id: string;
    source: "slack" | "jira" | "github" | "zendesk" | "system";
    event_type: "slack.message" | "slack.thread_reply" | "slack.reaction_added" | "slack.reaction_removed" | "slack.channel_created" | "slack.thread_resolved" | "jira.issue_created" | "jira.issue_updated" | "jira.issue_transitioned" | "jira.issue_reopened" | "jira.comment_added" | "github.pr_opened" | "github.pr_updated" | "github.pr_merged" | "github.pr_closed" | "github.review_requested" | "github.review_submitted" | "github.comment_added" | "system.digest_sent" | "system.action_executed";
    timestamp: Date;
    metadata: Record<string, unknown>;
    provider_event_id: string;
}, {
    company_id: string;
    entity_id: string;
    source: "slack" | "jira" | "github" | "zendesk" | "system";
    event_type: "slack.message" | "slack.thread_reply" | "slack.reaction_added" | "slack.reaction_removed" | "slack.channel_created" | "slack.thread_resolved" | "jira.issue_created" | "jira.issue_updated" | "jira.issue_transitioned" | "jira.issue_reopened" | "jira.comment_added" | "github.pr_opened" | "github.pr_updated" | "github.pr_merged" | "github.pr_closed" | "github.review_requested" | "github.review_submitted" | "github.comment_added" | "system.digest_sent" | "system.action_executed";
    timestamp: Date;
    provider_event_id: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type CreateEvent = z.infer<typeof CreateEventSchema>;
