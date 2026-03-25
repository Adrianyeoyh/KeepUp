import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ScopeProvider } from "@/hooks/useScope";
import DashboardOverview from "@/pages/app/DashboardOverview";
import LeaksPage from "@/pages/app/LeaksPage";
import ApprovalsPage from "@/pages/app/ApprovalsPage";
import LedgerPage from "@/pages/app/LedgerPage";
import MetricsPage from "@/pages/app/MetricsPage";
import SettingsPage from "@/pages/app/SettingsPage";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopeProvider>{children}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Mock fetch to return empty data by default
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ leaks: [], actions: [], commits: [], metrics: [], total: 0, company: null, events: { total: 0, by_source: {} }, recent_leaks: [], integrations: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
});

describe("DashboardOverview", () => {
  it("renders the Dashboard heading", async () => {
    render(<DashboardOverview />, { wrapper });
    expect(await screen.findByText("Dashboard")).toBeDefined();
  });
});

describe("LeaksPage", () => {
  it("renders the Leaks heading", async () => {
    render(<LeaksPage />, { wrapper });
    expect(await screen.findByText("Leaks")).toBeDefined();
  });

  it("shows empty state when no leaks", async () => {
    render(<LeaksPage />, { wrapper });
    expect(await screen.findByText("No leaks match your filters.")).toBeDefined();
  });
});

describe("ApprovalsPage", () => {
  it("renders the Approvals heading", async () => {
    render(<ApprovalsPage />, { wrapper });
    expect(await screen.findByText("Approvals")).toBeDefined();
  });
});

describe("LedgerPage", () => {
  it("renders the Git Ledger heading", async () => {
    render(<LedgerPage />, { wrapper });
    expect(await screen.findByText("Git Ledger")).toBeDefined();
  });
});

describe("MetricsPage", () => {
  it("renders the Metrics heading", async () => {
    // Recharts uses ResizeObserver
    vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })));
    render(<MetricsPage />, { wrapper });
    expect(await screen.findByText("Metrics")).toBeDefined();
  });
});

describe("SettingsPage", () => {
  it("renders the Settings heading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ company: { id: "1", name: "Test Co", settings: {} }, integrations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    render(<SettingsPage />, { wrapper });
    expect(await screen.findByText("Settings")).toBeDefined();
  });
});
