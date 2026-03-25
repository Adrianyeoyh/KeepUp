import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ============================================
// ScopeContext — Global team/project filter state
//
// Used by all dashboard pages to scope API calls.
// When a user picks a team in the sidebar, all pages
// automatically re-fetch with ?team_id=xxx applied.
// ============================================

interface Team {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  project_count: string;
  event_count_7d: string;
  active_leak_count: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
  status: string;
}

interface ScopeState {
  teamId: string | null;
  projectId: string | null;
  setTeamId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
  teams: Team[];
  projects: Project[];
  isLoadingTeams: boolean;
  isLoadingProjects: boolean;
  /** Builds query string fragment for scoped API calls */
  scopeParams: string;
}

const ScopeContext = createContext<ScopeState | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const { data: teamsData, isLoading: isLoadingTeams } = useQuery<{ teams: Team[] }>({
    queryKey: ["teams"],
    queryFn: () => apiFetch("/api/teams"),
    refetchInterval: 60000,
  });

  const { data: projectsData, isLoading: isLoadingProjects } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects", teamId],
    queryFn: () => apiFetch(`/api/projects${teamId ? `?team_id=${teamId}` : ""}`),
    refetchInterval: 60000,
  });

  // When switching teams, clear project selection if it doesn't belong to the new team
  useEffect(() => {
    if (projectId && projectsData?.projects) {
      const stillValid = projectsData.projects.some((p) => p.id === projectId);
      if (!stillValid) setProjectId(null);
    }
  }, [teamId, projectsData, projectId]);

  // Build URL query fragment for scoped API calls
  const scopeParams = [
    teamId ? `team_id=${teamId}` : "",
    projectId ? `project_id=${projectId}` : "",
  ]
    .filter(Boolean)
    .join("&");

  return (
    <ScopeContext.Provider
      value={{
        teamId,
        projectId,
        setTeamId,
        setProjectId,
        teams: teamsData?.teams ?? [],
        projects: projectsData?.projects ?? [],
        isLoadingTeams,
        isLoadingProjects,
        scopeParams,
      }}
    >
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within ScopeProvider");
  return ctx;
}
