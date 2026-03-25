import { z } from 'zod';
export declare const ExecutionResultSchema: z.ZodEnum<["success", "partial_success", "failure", "rolled_back"]>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
export declare const ExecutedActionSchema: z.ZodObject<{
    id: z.ZodString;
    company_id: z.ZodString;
    proposed_action_id: z.ZodString;
    executed_at: z.ZodDate;
    result: z.ZodEnum<["success", "partial_success", "failure", "rolled_back"]>;
    execution_details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rollback_info: z.ZodDefault<z.ZodObject<{
        can_rollback: z.ZodBoolean;
        rollback_type: z.ZodOptional<z.ZodString>;
        rollback_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        rolled_back_at: z.ZodOptional<z.ZodDate>;
        rolled_back_by: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        can_rollback: boolean;
        rollback_data: Record<string, unknown>;
        rollback_type?: string | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    }, {
        can_rollback: boolean;
        rollback_type?: string | undefined;
        rollback_data?: Record<string, unknown> | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    }>>;
    audit_log: z.ZodDefault<z.ZodArray<z.ZodObject<{
        timestamp: z.ZodDate;
        action: z.ZodString;
        actor: z.ZodString;
        details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        timestamp: Date;
        details: Record<string, unknown>;
        action: string;
        actor: string;
    }, {
        timestamp: Date;
        action: string;
        actor: string;
        details?: Record<string, unknown> | undefined;
    }>, "many">>;
    created_at: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: Date;
    company_id: string;
    proposed_action_id: string;
    executed_at: Date;
    result: "rolled_back" | "success" | "partial_success" | "failure";
    execution_details: Record<string, unknown>;
    rollback_info: {
        can_rollback: boolean;
        rollback_data: Record<string, unknown>;
        rollback_type?: string | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    };
    audit_log: {
        timestamp: Date;
        details: Record<string, unknown>;
        action: string;
        actor: string;
    }[];
}, {
    id: string;
    created_at: Date;
    company_id: string;
    proposed_action_id: string;
    executed_at: Date;
    result: "rolled_back" | "success" | "partial_success" | "failure";
    execution_details?: Record<string, unknown> | undefined;
    rollback_info?: {
        can_rollback: boolean;
        rollback_type?: string | undefined;
        rollback_data?: Record<string, unknown> | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    } | undefined;
    audit_log?: {
        timestamp: Date;
        action: string;
        actor: string;
        details?: Record<string, unknown> | undefined;
    }[] | undefined;
}>;
export type ExecutedAction = z.infer<typeof ExecutedActionSchema>;
export declare const CreateExecutedActionSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    company_id: z.ZodString;
    proposed_action_id: z.ZodString;
    executed_at: z.ZodDate;
    result: z.ZodEnum<["success", "partial_success", "failure", "rolled_back"]>;
    execution_details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rollback_info: z.ZodDefault<z.ZodObject<{
        can_rollback: z.ZodBoolean;
        rollback_type: z.ZodOptional<z.ZodString>;
        rollback_data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        rolled_back_at: z.ZodOptional<z.ZodDate>;
        rolled_back_by: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        can_rollback: boolean;
        rollback_data: Record<string, unknown>;
        rollback_type?: string | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    }, {
        can_rollback: boolean;
        rollback_type?: string | undefined;
        rollback_data?: Record<string, unknown> | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    }>>;
    audit_log: z.ZodDefault<z.ZodArray<z.ZodObject<{
        timestamp: z.ZodDate;
        action: z.ZodString;
        actor: z.ZodString;
        details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        timestamp: Date;
        details: Record<string, unknown>;
        action: string;
        actor: string;
    }, {
        timestamp: Date;
        action: string;
        actor: string;
        details?: Record<string, unknown> | undefined;
    }>, "many">>;
    created_at: z.ZodDate;
}, "id" | "created_at">, "strip", z.ZodTypeAny, {
    company_id: string;
    proposed_action_id: string;
    executed_at: Date;
    result: "rolled_back" | "success" | "partial_success" | "failure";
    execution_details: Record<string, unknown>;
    rollback_info: {
        can_rollback: boolean;
        rollback_data: Record<string, unknown>;
        rollback_type?: string | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    };
    audit_log: {
        timestamp: Date;
        details: Record<string, unknown>;
        action: string;
        actor: string;
    }[];
}, {
    company_id: string;
    proposed_action_id: string;
    executed_at: Date;
    result: "rolled_back" | "success" | "partial_success" | "failure";
    execution_details?: Record<string, unknown> | undefined;
    rollback_info?: {
        can_rollback: boolean;
        rollback_type?: string | undefined;
        rollback_data?: Record<string, unknown> | undefined;
        rolled_back_at?: Date | undefined;
        rolled_back_by?: string | undefined;
    } | undefined;
    audit_log?: {
        timestamp: Date;
        action: string;
        actor: string;
        details?: Record<string, unknown> | undefined;
    }[] | undefined;
}>;
export type CreateExecutedAction = z.infer<typeof CreateExecutedActionSchema>;
