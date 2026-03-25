import { z } from 'zod';
export declare const IntegrationProviderSchema: z.ZodEnum<["slack", "jira", "github", "zendesk"]>;
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;
export declare const IntegrationStatusSchema: z.ZodEnum<["pending", "active", "error", "revoked"]>;
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;
export declare const IntegrationSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    provider: z.ZodEnum<["slack", "jira", "github", "zendesk"]>;
    status: z.ZodEnum<["pending", "active", "error", "revoked"]>;
    installation_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    token_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    scopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    webhook_secret: z.ZodOptional<z.ZodString>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "error" | "pending" | "active" | "revoked";
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    provider: "slack" | "jira" | "github" | "zendesk";
    installation_data: Record<string, unknown>;
    token_data: Record<string, unknown>;
    scopes: string[];
    webhook_secret?: string | undefined;
}, {
    status: "error" | "pending" | "active" | "revoked";
    id: string;
    created_at: Date;
    updated_at: Date;
    company_id: string;
    provider: "slack" | "jira" | "github" | "zendesk";
    installation_data?: Record<string, unknown> | undefined;
    token_data?: Record<string, unknown> | undefined;
    scopes?: string[] | undefined;
    webhook_secret?: string | undefined;
}>;
export type Integration = z.infer<typeof IntegrationSchema>;
export declare const CreateIntegrationSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    company_id: z.ZodString;
    provider: z.ZodEnum<["slack", "jira", "github", "zendesk"]>;
    status: z.ZodEnum<["pending", "active", "error", "revoked"]>;
    installation_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    token_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    scopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    webhook_secret: z.ZodOptional<z.ZodString>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "id" | "created_at" | "updated_at">, "strip", z.ZodTypeAny, {
    status: "error" | "pending" | "active" | "revoked";
    company_id: string;
    provider: "slack" | "jira" | "github" | "zendesk";
    installation_data: Record<string, unknown>;
    token_data: Record<string, unknown>;
    scopes: string[];
    webhook_secret?: string | undefined;
}, {
    status: "error" | "pending" | "active" | "revoked";
    company_id: string;
    provider: "slack" | "jira" | "github" | "zendesk";
    installation_data?: Record<string, unknown> | undefined;
    token_data?: Record<string, unknown> | undefined;
    scopes?: string[] | undefined;
    webhook_secret?: string | undefined;
}>;
export type CreateIntegration = z.infer<typeof CreateIntegrationSchema>;
