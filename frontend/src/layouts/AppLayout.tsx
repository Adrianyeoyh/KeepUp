import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  AlertTriangle,
  CheckSquare,
  GitCommit,
  Settings,
  BarChart3,
  ArrowLeft,
  Shield,
  Users,
  FolderOpen,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScope, ScopeProvider } from "@/hooks/useScope";
import { useIsMobile } from "@/hooks/use-mobile";

const navigation = [
  { name: "Overview", href: "/app", icon: LayoutDashboard, end: true },
  { name: "Leaks", href: "/app/leaks", icon: AlertTriangle },
  { name: "Approvals", href: "/app/approvals", icon: CheckSquare },
  { name: "Ledger", href: "/app/ledger", icon: GitCommit },
  { name: "Metrics", href: "/app/metrics", icon: BarChart3 },
];

const managementNav = [
  { name: "Teams", href: "/app/teams", icon: Users },
  { name: "Projects", href: "/app/projects", icon: FolderOpen },
  { name: "Settings", href: "/app/settings", icon: Settings },
];

function AppLayoutInner() {
  const location = useLocation();
  const { teams, teamId, setTeamId, setProjectId } = useScope();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  const closeSidebarOnMobile = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {isMobile && (
        <header className="fixed inset-x-0 top-0 z-40 h-16 bg-gray-900/95 border-b border-gray-800 backdrop-blur-sm">
          <div className="h-full px-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Shield className="h-6 w-6 text-cyan-400" />
              <span className="text-base font-bold tracking-tight">
                Flow<span className="text-cyan-400">Guard</span>
              </span>
            </div>
            <button
              type="button"
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              className="h-9 w-9 rounded-md border border-gray-700/80 text-gray-300 hover:bg-gray-800/80 transition-colors flex items-center justify-center"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              {sidebarOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
            </button>
          </div>
        </header>
      )}

      {isMobile && sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-30 bg-gray-950/75"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "w-64 bg-gray-900/95 border-r border-gray-800 flex flex-col fixed inset-y-0 left-0 z-40 transition-transform duration-200",
          isMobile ? (sidebarOpen ? "translate-x-0" : "-translate-x-full") : "translate-x-0",
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-gray-800">
          <Shield className="h-7 w-7 text-cyan-400" />
          <span className="text-lg font-bold tracking-tight">
            Flow<span className="text-cyan-400">Guard</span>
          </span>
        </div>

        {/* Team Scope Selector */}
        <div className="px-3 pt-4 pb-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-3 mb-1.5">
            Scope
          </p>
          <select
            value={teamId || ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setTeamId(val);
              setProjectId(null);
            }}
            className="w-full bg-gray-800/80 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-2 appearance-none cursor-pointer hover:border-gray-600 transition-colors focus:outline-none focus:border-cyan-500/50"
          >
            <option value="">All Teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Main Nav */}
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-3 mb-1.5 mt-2">
            Dashboard
          </p>
          {navigation.map((item) => {
            const isActive = item.end
              ? location.pathname === item.href
              : location.pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={closeSidebarOnMobile}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                )}
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.name}
              </NavLink>
            );
          })}

          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-3 mb-1.5 mt-5">
            Manage
          </p>
          {managementNav.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={closeSidebarOnMobile}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                )}
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-800">
          <NavLink
            to="/"
            onClick={closeSidebarOnMobile}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to site
          </NavLink>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn("flex-1 min-w-0", isMobile ? "ml-0 pt-16" : "ml-64")}>
        <div className="p-4 sm:p-6 md:p-8">
          <Outlet />
        </div>
      </main>
      </div>
    </div>
  );
}

export default function AppLayout() {
  return (
    <ScopeProvider>
      <AppLayoutInner />
    </ScopeProvider>
  );
}
