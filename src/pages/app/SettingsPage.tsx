import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Settings, Zap, Shield, Loader2, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SettingsData {
  company: {
    id: string;
    name: string;
    settings: Record<string, unknown>;
  };
  integrations: Array<{
    id: string;
    provider: string;
    status: string;
    installation_data: Record<string, unknown>;
    scopes: string[];
    updated_at: string;
  }>;
}

interface HealthData {
  status: string;
  timestamp: string;
  database: string;
  counts: {
    companies: number;
    events: number;
    leaks: number;
  };
}

const providerIcons: Record<string, string> = {
  slack: "💬",
  jira: "📋",
  github: "🐙",
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    active: "bg-green-500/15 text-green-400 border-green-500/30",
    inactive: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    error: "bg-red-500/15 text-red-400 border-red-500/30",
    ok: "bg-green-500/15 text-green-400 border-green-500/30",
    degraded: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return map[status] || "bg-gray-500/15 text-gray-400 border-gray-500/30";
};

const serviceStatus = (s: string) =>
  s === "ok" ? "bg-green-500/15 text-green-400 border-green-500/30" : "bg-red-500/15 text-red-400 border-red-500/30";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: () => apiFetch("/api/settings"),
  });

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery<HealthData>({
    queryKey: ["health"],
    queryFn: () => apiFetch("/api/health/detailed"),
    refetchInterval: 15000,
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-gray-400" />
          Settings
        </h1>
        <p className="text-gray-400 mt-1">Integration status, system health, and configuration</p>
      </div>

      {/* System Health */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5 text-cyan-400" />
            System Health
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="border-gray-700 text-gray-400"
            onClick={() => refetchHealth()}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>

        {healthLoading ? (
          <Card className="bg-gray-900/60 border-gray-800 animate-pulse">
            <CardContent className="pt-5"><div className="h-24" /></CardContent>
          </Card>
        ) : health ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-gray-400 font-medium">Overall Status</p>
                <Badge className={statusBadge(health.status === 'healthy' ? 'ok' : health.status)} variant="outline">
                  {health.status}
                </Badge>
                <p className="text-xs text-gray-500 mt-2">
                  As of: {new Date(health.timestamp).toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-gray-400 font-medium">Database</p>
                <div className="flex items-center gap-2 mt-1">
                  {health.database === "ok" ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                  <span className="text-sm">{health.database}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-gray-400 font-medium">Data Counts</p>
                <div className="space-y-1 mt-1">
                  {Object.entries(health.counts || {}).map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 capitalize">{name}</span>
                      <span className="text-gray-300">{count as number}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="bg-gray-900/60 border-gray-800">
            <CardContent className="pt-6 text-center text-gray-500">
              Unable to reach health endpoint.
            </CardContent>
          </Card>
        )}
      </section>

      {/* Integrations */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-400" />
          Integrations
        </h2>

        {settingsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-gray-900/60 border-gray-800 animate-pulse">
                <CardContent className="pt-5"><div className="h-12" /></CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {(settings?.integrations || []).map((integ) => (
              <Card key={integ.id} className="bg-gray-900/60 border-gray-800">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{providerIcons[integ.provider] || "⚡"}</span>
                      <div>
                        <span className="font-medium capitalize">{integ.provider}</span>
                        <p className="text-xs text-gray-500">
                          Last updated: {new Date(integ.updated_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Badge className={statusBadge(integ.status)} variant="outline">
                      {integ.status}
                    </Badge>
                  </div>
                  {integ.installation_data && Object.keys(integ.installation_data).length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                        Installation details
                      </summary>
                      <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                        {Object.entries(integ.installation_data).map(([k, v]) => (
                          <p key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</p>
                        ))}
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}
            {(settings?.integrations || []).length === 0 && (
              <Card className="bg-gray-900/60 border-gray-800">
                <CardContent className="pt-6 text-center text-gray-500">
                  No integrations configured.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* Company Settings */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Company Configuration</h2>
        {settings?.company ? (
          <Card className="bg-gray-900/60 border-gray-800">
            <CardContent className="pt-4 pb-4">
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 font-medium">Company Name</label>
                  <p className="text-sm mt-0.5">{settings.company.name}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium">Settings (JSON)</label>
                  <pre className="text-xs text-gray-400 bg-gray-800/60 rounded p-3 mt-1 overflow-x-auto max-h-48">
                    {JSON.stringify(settings.company.settings, null, 2)}
                  </pre>
                </div>
                {saved && (
                  <p className="text-sm text-green-400 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> Settings saved
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gray-900/60 border-gray-800">
            <CardContent className="pt-6 text-center text-gray-500">
              No company found. Run <code className="text-cyan-400 mx-1">npm run seed:dev</code>.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
