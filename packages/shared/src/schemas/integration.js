import { z } from 'zod';
// ============================================
// Integration (per-tool connection per company)
// ============================================
export const IntegrationProviderSchema = z.enum([
    'slack',
    'jira',
    'github',
    'zendesk', // Phase 2+ (Wedge B)
]);
export const IntegrationStatusSchema = z.enum([
    'pending',
    'active',
    'error',
    'revoked',
]);
export const IntegrationSchema = z.object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    provider: IntegrationProviderSchema,
    status: IntegrationStatusSchema,
    // Provider-specific installation data (team_id, app_id, etc.)
    installation_data: z.record(z.unknown()).default({}),
    // Encrypted token references — never store raw tokens in plain JSON
    // In practice, tokens go into a vault or encrypted column
    token_data: z.record(z.unknown()).default({}),
    scopes: z.array(z.string()).default([]),
    webhook_secret: z.string().optional(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
});
export const CreateIntegrationSchema = IntegrationSchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
});
//# sourceMappingURL=integration.js.map