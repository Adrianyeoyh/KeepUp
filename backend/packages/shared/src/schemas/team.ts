import { z } from "zod";

// ============================================
// Team
// A group of people who share ownership of
// Slack channels, Jira projects, and GitHub repos.
// ============================================

export const TeamSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  lead_user_id: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(), // hex color e.g. #3B82F6
  icon: z.string().optional(), // lucide icon name
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type Team = z.infer<typeof TeamSchema>;

export const CreateTeamSchema = TeamSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateTeam = z.infer<typeof CreateTeamSchema>;

export const UpdateTeamSchema = CreateTeamSchema.partial().omit({
  company_id: true,
});
export type UpdateTeam = z.infer<typeof UpdateTeamSchema>;
