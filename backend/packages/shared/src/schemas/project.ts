import { z } from 'zod';

// ============================================
// Project
// Maps 1:1 to a Jira epic/project or initiative.
// Ties together Slack channels, Jira issues, and GitHub repos.
// The arrays (jira_project_keys, github_repos, slack_channel_ids) are
// used by EntityResolver to auto-scope incoming webhook events.
// ============================================

export const ProjectStatusSchema = z.enum(['active', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  team_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  // External identifiers for auto-linking webhook events to this project
  jira_project_keys: z.array(z.string()).default([]),   // e.g. ['PLAT', 'AUTH']
  github_repos: z.array(z.string()).default([]),         // e.g. ['acme/api', 'acme/web']
  slack_channel_ids: z.array(z.string()).default([]),    // e.g. ['C0123ABC']
  status: ProjectStatusSchema.default('active'),
  start_date: z.coerce.date().nullable().optional(),
  target_date: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = ProjectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial().omit({ company_id: true });
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
