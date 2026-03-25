import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  GitBranch,
  MessageSquare,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Project {
  id: string;
  company_id: string;
  team_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  jira_project_keys: string[];
  github_repos: string[];
  slack_channel_ids: string[];
  status: string;
  start_date: string | null;
  target_date: string | null;
  team_name: string | null;
  team_color: string | null;
  event_count_7d: string;
  active_leak_count: string;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  color: string | null;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const statusColors: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/30",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  archived: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

function normalizeCsvList(input: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const token of input.split(",")) {
    const value = token.trim();
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    values.push(value);
  }
  return values;
}

function normalizeJiraKeys(input: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const token of input.split(",")) {
    const key = token.trim().toUpperCase().replace(/\s+/g, "");
    if (!key) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | null): string {
  const normalized = toDateInputValue(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function ProjectsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const { data, isLoading, error } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects"],
    queryFn: () => apiFetch("/api/projects"),
  });

  const { data: teamsData } = useQuery<{ teams: Team[] }>({
    queryKey: ["teams"],
    queryFn: () => apiFetch("/api/teams"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsCreateOpen(false);
      toast({ title: "Project created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setEditingProject(null);
      toast({ title: "Project updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
              <CardContent className="pt-6"><div className="h-32" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="pt-6 text-center text-gray-400">
            <p>Unable to load projects. Make sure your API is running.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const projects = data?.projects ?? [];
  const teams = teamsData?.teams ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-gray-400 mt-1">
            Map Jira projects, GitHub repos, and Slack channels to track cross-tool activity.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-cyan-600 hover:bg-cyan-700 text-white gap-2">
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
            <ProjectForm
              teams={teams}
              onSubmit={(values) => createMutation.mutate(values)}
              isLoading={createMutation.isPending}
              submitLabel="Create Project"
            />
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300">No projects yet</h3>
            <p className="text-gray-500 mt-1 max-w-md mx-auto">
              Create a project and link your Jira project keys, GitHub repos, 
              and Slack channel IDs to auto-scope incoming events.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => {
            const jiraKeys = Array.isArray(project.jira_project_keys)
              ? project.jira_project_keys.map((key) => key.toUpperCase())
              : [];
            const githubRepos = Array.isArray(project.github_repos) ? project.github_repos : [];
            const slackChannels = Array.isArray(project.slack_channel_ids) ? project.slack_channel_ids : [];
            const targetDateLabel = formatDateLabel(project.target_date);

            return (
              <Card key={project.id} className="bg-gray-900/60 border-gray-800 hover:border-gray-700 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-cyan-400" />
                      <Link to={`/app/projects/${project.id}`} className="hover:text-cyan-400 transition-colors">
                        <CardTitle className="text-base">{project.name}</CardTitle>
                      </Link>
                      <Badge className={statusColors[project.status] || statusColors.active} variant="outline">
                        {project.status}
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Dialog open={editingProject?.id === project.id} onOpenChange={(open) => !open && setEditingProject(null)}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-500 hover:text-gray-300"
                            onClick={() => setEditingProject(project)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
                          <ProjectForm
                            teams={teams}
                            initialValues={project}
                            onSubmit={(values) => updateMutation.mutate({ id: project.id, ...values })}
                            isLoading={updateMutation.isPending}
                            submitLabel="Save Changes"
                          />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-500 hover:text-red-400"
                        onClick={() => {
                          if (confirm(`Delete project "${project.name}"?`)) {
                            deleteMutation.mutate(project.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {project.team_name && (
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: project.team_color || "#6B7280" }}
                      />
                      <span className="text-xs text-gray-400">{project.team_name}</span>
                    </div>
                  )}

                  {project.description && (
                    <p className="text-sm text-gray-400">{project.description}</p>
                  )}

                  {/* Connected tools */}
                  <div className="space-y-1.5 text-xs text-gray-500">
                    {jiraKeys.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span>🎫</span>
                        <span>Jira: {jiraKeys.join(", ")}</span>
                      </div>
                    )}
                    {githubRepos.length > 0 && (
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3 w-3" />
                        <span>{githubRepos.join(", ")}</span>
                      </div>
                    )}
                    {slackChannels.length > 0 && (
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3 w-3" />
                        <span>{slackChannels.length} channel(s)</span>
                      </div>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="flex gap-4 pt-1 border-t border-gray-800/50">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Activity className="h-3 w-3 text-blue-400" />
                      <span className="text-gray-400">{project.event_count_7d} events 7d</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                      <span className="text-gray-400">{project.active_leak_count} leaks</span>
                    </div>
                    {targetDateLabel && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Calendar className="h-3 w-3 text-gray-500" />
                        <span className="text-gray-400">Target: {targetDateLabel}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// ProjectForm — Used for both Create and Edit
// ============================================
function ProjectForm({
  teams,
  initialValues,
  onSubmit,
  isLoading,
  submitLabel,
}: {
  teams: Team[];
  initialValues?: Partial<Project>;
  onSubmit: (values: Record<string, unknown>) => void;
  isLoading: boolean;
  submitLabel: string;
}) {
  const [name, setName] = useState(initialValues?.name || "");
  const [slug, setSlug] = useState(initialValues?.slug || "");
  const [description, setDescription] = useState(initialValues?.description || "");
  const [teamId, setTeamId] = useState(initialValues?.team_id || "");
  const [jiraKeys, setJiraKeys] = useState(
    Array.isArray(initialValues?.jira_project_keys) ? initialValues.jira_project_keys.join(", ") : "",
  );
  const [githubRepos, setGithubRepos] = useState(
    Array.isArray(initialValues?.github_repos) ? initialValues.github_repos.join(", ") : "",
  );
  const [slackChannels, setSlackChannels] = useState(
    Array.isArray(initialValues?.slack_channel_ids) ? initialValues.slack_channel_ids.join(", ") : "",
  );
  const [targetDate, setTargetDate] = useState(() => toDateInputValue(initialValues?.target_date));
  const [autoSlug, setAutoSlug] = useState(!initialValues?.slug);

  const handleNameChange = (val: string) => {
    setName(val);
    if (autoSlug) setSlug(slugify(val));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      team_id: teamId || null,
      name,
      slug,
      description: description || null,
      jira_project_keys: normalizeJiraKeys(jiraKeys),
      github_repos: normalizeCsvList(githubRepos),
      slack_channel_ids: normalizeCsvList(slackChannels),
      target_date: targetDate || null,
    };
    if (initialValues?.company_id) {
      payload.company_id = initialValues.company_id;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{initialValues?.id ? "Edit Project" : "Create Project"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div>
          <Label htmlFor="proj-name">Name</Label>
          <Input
            id="proj-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Q2 Auth Migration"
            className="bg-gray-800 border-gray-700 mt-1"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="proj-slug">Slug</Label>
            <Input
              id="proj-slug"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setAutoSlug(false); }}
              className="bg-gray-800 border-gray-700 mt-1"
              required
            />
          </div>
          <div>
            <Label>Team</Label>
            <Select value={teamId} onValueChange={(v) => setTeamId(v === "none" ? "" : v)}>
              <SelectTrigger className="bg-gray-800 border-gray-700 mt-1">
                <SelectValue placeholder="No team" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="none">No team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color || "#6B7280" }} />
                      {t.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="proj-desc">Description</Label>
          <Input
            id="proj-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="bg-gray-800 border-gray-700 mt-1"
          />
        </div>
        <div>
          <Label htmlFor="proj-jira">Jira Project Keys</Label>
          <Input
            id="proj-jira"
            value={jiraKeys}
            onChange={(e) => setJiraKeys(e.target.value)}
            placeholder="PLAT, AUTH (comma-separated)"
            className="bg-gray-800 border-gray-700 mt-1"
          />
          <p className="text-[10px] text-gray-600 mt-1">Events from these Jira projects will auto-scope to this project.</p>
        </div>
        <div>
          <Label htmlFor="proj-github">GitHub Repos</Label>
          <Input
            id="proj-github"
            value={githubRepos}
            onChange={(e) => setGithubRepos(e.target.value)}
            placeholder="acme/api, acme/web (comma-separated)"
            className="bg-gray-800 border-gray-700 mt-1"
          />
        </div>
        <div>
          <Label htmlFor="proj-slack">Slack Channel IDs</Label>
          <Input
            id="proj-slack"
            value={slackChannels}
            onChange={(e) => setSlackChannels(e.target.value)}
            placeholder="C0123ABC, C0456DEF (comma-separated)"
            className="bg-gray-800 border-gray-700 mt-1"
          />
        </div>
        <div>
          <Label htmlFor="proj-target">Target Date</Label>
          <Input
            id="proj-target"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="bg-gray-800 border-gray-700 mt-1"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          type="submit"
          className="bg-cyan-600 hover:bg-cyan-700"
          disabled={isLoading || !name || !slug}
        >
          {isLoading ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
