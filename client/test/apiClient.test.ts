import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";

// We need to mock fetch at the global level to test the api client
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Replace location so href assignment doesn't trigger a real navigation
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "", pathname: "/feedings", search: "" },
    });
  });

  it("makes GET requests with correct headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ id: 1 }]),
    });

    const result = await api.get("/children");

    expect(mockFetch).toHaveBeenCalledWith("/api/children", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("makes POST requests with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 1, first_name: "Emma" }),
    });

    const result = await api.post("/children", { first_name: "Emma", birth_date: "2024-06-15" });

    expect(mockFetch).toHaveBeenCalledWith("/api/children", {
      method: "POST",
      body: JSON.stringify({ first_name: "Emma", birth_date: "2024-06-15" }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(result).toEqual({ id: 1, first_name: "Emma" });
  });

  it("makes DELETE requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    await api.delete("/children/1");

    expect(mockFetch).toHaveBeenCalledWith("/api/children/1", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  it("throws on non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Bad request" }),
    });

    await expect(api.get("/children")).rejects.toThrow("Bad request");
  });

  it("navigates to the login route on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    expect(window.location.href).toBe("/api/auth/login?redirect=%2Ffeedings");
  });

  it("navigates to the login route when fetch throws (e.g. CF Access redirect blocked by CORS)", async () => {
    // The session probe is blocked the same way, confirming the session is gone.
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    expect(window.location.href).toBe("/api/auth/login?redirect=%2Ffeedings");
  });

  it("reports a network error instead of re-authing when the session is still good", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 1 }) });

    await expect(api.get("/children")).rejects.toThrow(/network error/i);
    // A dropped connection must not navigate away from a half-filled form.
    expect(window.location.href).toBe("");
  });

  it("does not re-send a failed POST while probing the session", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 1 }) });

    await expect(api.post("/feedings", { child_id: 1 })).rejects.toThrow(/network error/i);

    const posts = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("treats a failure while offline as a network error, without probing", async () => {
    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    try {
      await expect(api.get("/children")).rejects.toThrow(/network error/i);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe("");
    } finally {
      if (onLine) Object.defineProperty(navigator, "onLine", onLine);
    }
  });

  it("does not redirect twice within the loop-guard window", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    window.location.href = "";
    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    expect(window.location.href).toBe("");
  });
});
