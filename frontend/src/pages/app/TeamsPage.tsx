import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, API_BASE } from "@/lib/api";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
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
import { useToast } from "@/hooks/use-toast";

interface Team {
  id: string;
  company_id: string;
  name: string;
  slug: string;
  description: string | null;
  lead_user_id: string | null;
  color: string | null;
  icon: string | null;
  project_count: string;
  event_count_7d: string;
  active_leak_count: string;
  created_at: string;
  updated_at: string;
}

interface TeamsResponse {
  teams: Team[];
}

const TEAM_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
];

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function TeamsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const { data, isLoading, error } = useQuery<TeamsResponse>({
    queryKey: ["teams"],
    queryFn: () => apiFetch("/api/teams"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setIsCreateOpen(false);
      toast({ title: "Team created", description: "Your new team is ready." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch(`/api/teams/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setEditingTeam(null);
      toast({ title: "Team updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast({ title: "Team deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Teams</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
              <CardContent className="pt-6"><div className="h-24" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Teams</h1>
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="pt-6 text-center text-gray-400">
            <p>Unable to load teams. Make sure your API is running.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const teams = data?.teams ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-gray-400 mt-1">
            Manage your engineering teams and their project associations.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-cyan-600 hover:bg-cyan-700 text-white gap-2">
              <Plus className="h-4 w-4" />
              New Team
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-gray-100">
            <TeamForm
              onSubmit={(values) => createMutation.mutate(values)}
              isLoading={createMutation.isPending}
              submitLabel="Create Team"
            />
          </DialogContent>
        </Dialog>
      </div>

      {teams.length === 0 ? (
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300">No teams yet</h3>
            <p className="text-gray-500 mt-1 max-w-md mx-auto">
              Create teams to group Slack channels, Jira projects, and GitHub repos.
              Events will be auto-scoped to the matching team.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => (
            <Card key={team.id} className="bg-gray-900/60 border-gray-800 hover:border-gray-700 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: team.color || "#6B7280" }}
                    />
                    <CardTitle className="text-base">{team.name}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Dialog open={editingTeam?.id === team.id} onOpenChange={(open) => !open && setEditingTeam(null)}>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-500 hover:text-gray-300"
                          onClick={() => setEditingTeam(team)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100">
                        <TeamForm
                          initialValues={team}
                          onSubmit={(values) => updateMutation.mutate({ id: team.id, ...values })}
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
                        if (confirm(`Delete team "${team.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(team.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {team.description && (
                  <p className="text-sm text-gray-400 mb-3">{team.description}</p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 rounded bg-gray-800/50">
                    <FolderOpen className="h-3.5 w-3.5 text-cyan-400 mx-auto mb-1" />
                    <p className="text-sm font-bold">{team.project_count}</p>
                    <p className="text-[10px] text-gray-500 uppercase">Projects</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-800/50">
                    <Activity className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
                    <p className="text-sm font-bold">{team.event_count_7d}</p>
                    <p className="text-[10px] text-gray-500 uppercase">Events 7d</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-800/50">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mx-auto mb-1" />
                    <p className="text-sm font-bold">{team.active_leak_count}</p>
                    <p className="text-[10px] text-gray-500 uppercase">Leaks</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 mt-3">
                  Created {new Date(team.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// TeamForm — Used for both Create and Edit
// ============================================
function TeamForm({
  initialValues,
  onSubmit,
  isLoading,
  submitLabel,
}: {
  initialValues?: Partial<Team>;
  onSubmit: (values: Record<string, unknown>) => void;
  isLoading: boolean;
  submitLabel: string;
}) {
  const [name, setName] = useState(initialValues?.name || "");
  const [slug, setSlug] = useState(initialValues?.slug || "");
  const [description, setDescription] = useState(initialValues?.description || "");
  const [color, setColor] = useState(initialValues?.color || TEAM_COLORS[0]);
  const [leadUserId, setLeadUserId] = useState(initialValues?.lead_user_id || "");
  const [autoSlug, setAutoSlug] = useState(!initialValues?.slug);

  // Auto-generate slug from name, unless user manually edits it
  const handleNameChange = (val: string) => {
    setName(val);
    if (autoSlug) setSlug(slugify(val));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Get company_id for create — we'll fetch it or use the MVP default
    onSubmit({
      company_id: initialValues?.company_id,
      name,
      slug,
      description: description || null,
      color,
      lead_user_id: leadUserId || null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{initialValues?.id ? "Edit Team" : "Create Team"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div>
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Platform Squad"
            className="bg-gray-800 border-gray-700 mt-1"
            required
          />
        </div>
        <div>
          <Label htmlFor="team-slug">Slug</Label>
          <Input
            id="team-slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setAutoSlug(false); }}
            placeholder="platform-squad"
            className="bg-gray-800 border-gray-700 mt-1"
            required
          />
        </div>
        <div>
          <Label htmlFor="team-desc">Description</Label>
          <Input
            id="team-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="bg-gray-800 border-gray-700 mt-1"
          />
        </div>
        <div>
          <Label>Color</Label>
          <div className="flex gap-2 mt-1">
            {TEAM_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`h-7 w-7 rounded-full border-2 transition-all ${
                  color === c ? "border-white scale-110" : "border-transparent hover:border-gray-600"
                }`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="team-lead">Lead User ID</Label>
          <Input
            id="team-lead"
            value={leadUserId}
            onChange={(e) => setLeadUserId(e.target.value)}
            placeholder="Optional (Slack/email)"
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
