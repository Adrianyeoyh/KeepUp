import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AppLayout from "./layouts/AppLayout";
import DashboardOverview from "./pages/app/DashboardOverview";
import LeaksPage from "./pages/app/LeaksPage";
import ApprovalsPage from "./pages/app/ApprovalsPage";
import LedgerPage from "./pages/app/LedgerPage";
import MetricsPage from "./pages/app/MetricsPage";
import SettingsPage from "./pages/app/SettingsPage";
import TeamsPage from "./pages/app/TeamsPage";
import ProjectsPage from "./pages/app/ProjectsPage";
import ProjectActivityPage from "./pages/app/ProjectActivityPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />

          {/* Dashboard app routes */}
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<DashboardOverview />} />
            <Route path="leaks" element={<LeaksPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectActivityPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
