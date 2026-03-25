import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, API_BASE } from "@/lib/api";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should construct correct URL from path", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    apiFetch("/api/dashboard/overview");

    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/api/dashboard/overview`,
      expect.objectContaining({ headers: expect.any(Headers) })
    );
  });

  it("should throw on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );

    await expect(apiFetch("/api/leaks")).rejects.toThrow("Not Found");
  });

  it("should parse JSON response", async () => {
    const mockData = { rows: [], total: 0 };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockData), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await apiFetch("/api/leaks");
    expect(result).toEqual(mockData);
  });

  it("should forward request options", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    apiFetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/api/settings`,
      expect.objectContaining({ method: "PATCH" })
    );
  });
});
