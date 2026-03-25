import { z } from 'zod';
// ============================================
// Company
// ============================================
export const CompanySchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    settings: z.object({
        insight_budget_per_day: z.number().int().min(1).max(10).default(3),
        confidence_threshold: z.number().min(0).max(1).default(0.5),
        digest_cron: z.string().default('0 9 * * 1-5'),
        digest_channel_ids: z.array(z.string()).default([]),
        digest_user_ids: z.array(z.string()).default([]),
    }).default({}),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
});
export const CreateCompanySchema = CompanySchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
});
//# sourceMappingURL=company.js.map