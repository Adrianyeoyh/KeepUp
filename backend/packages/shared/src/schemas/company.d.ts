import { z } from 'zod';
export declare const CompanySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    settings: z.ZodDefault<z.ZodObject<{
        insight_budget_per_day: z.ZodDefault<z.ZodNumber>;
        confidence_threshold: z.ZodDefault<z.ZodNumber>;
        digest_cron: z.ZodDefault<z.ZodString>;
        digest_channel_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        digest_user_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        insight_budget_per_day: number;
        confidence_threshold: number;
        digest_cron: string;
        digest_channel_ids: string[];
        digest_user_ids: string[];
    }, {
        insight_budget_per_day?: number | undefined;
        confidence_threshold?: number | undefined;
        digest_cron?: string | undefined;
        digest_channel_ids?: string[] | undefined;
        digest_user_ids?: string[] | undefined;
    }>>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    slug: string;
    settings: {
        insight_budget_per_day: number;
        confidence_threshold: number;
        digest_cron: string;
        digest_channel_ids: string[];
        digest_user_ids: string[];
    };
    created_at: Date;
    updated_at: Date;
}, {
    id: string;
    name: string;
    slug: string;
    created_at: Date;
    updated_at: Date;
    settings?: {
        insight_budget_per_day?: number | undefined;
        confidence_threshold?: number | undefined;
        digest_cron?: string | undefined;
        digest_channel_ids?: string[] | undefined;
        digest_user_ids?: string[] | undefined;
    } | undefined;
}>;
export type Company = z.infer<typeof CompanySchema>;
export declare const CreateCompanySchema: z.ZodObject<Omit<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    settings: z.ZodDefault<z.ZodObject<{
        insight_budget_per_day: z.ZodDefault<z.ZodNumber>;
        confidence_threshold: z.ZodDefault<z.ZodNumber>;
        digest_cron: z.ZodDefault<z.ZodString>;
        digest_channel_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        digest_user_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        insight_budget_per_day: number;
        confidence_threshold: number;
        digest_cron: string;
        digest_channel_ids: string[];
        digest_user_ids: string[];
    }, {
        insight_budget_per_day?: number | undefined;
        confidence_threshold?: number | undefined;
        digest_cron?: string | undefined;
        digest_channel_ids?: string[] | undefined;
        digest_user_ids?: string[] | undefined;
    }>>;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
}, "id" | "created_at" | "updated_at">, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    settings: {
        insight_budget_per_day: number;
        confidence_threshold: number;
        digest_cron: string;
        digest_channel_ids: string[];
        digest_user_ids: string[];
    };
}, {
    name: string;
    slug: string;
    settings?: {
        insight_budget_per_day?: number | undefined;
        confidence_threshold?: number | undefined;
        digest_cron?: string | undefined;
        digest_channel_ids?: string[] | undefined;
        digest_user_ids?: string[] | undefined;
    } | undefined;
}>;
export type CreateCompany = z.infer<typeof CreateCompanySchema>;
