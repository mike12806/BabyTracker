import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, pingServer, REQUEST_TIMEOUT_MS, GENERATION_TIMEOUT_MS } from "../src/api/client";
import { getStaleSince, resetFreshness } from "../src/api/freshness";
import { liveClientId } from "../src/api/live";

// We need to mock fetch at the global level to test the api client
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    resetFreshness();
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
        // Names this tab's live socket so the server can skip it when fanning
        // the change out — see `api/live.ts`.
        "X-Live-Client": liveClientId(),
      },
      // Every request carries a deadline — see REQUEST_TIMEOUT_MS.
      signal: expect.any(AbortSignal),
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
        // Names this tab's live socket so the server can skip it when fanning
        // the change out — see `api/live.ts`.
        "X-Live-Client": liveClientId(),
      },
      signal: expect.any(AbortSignal),
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
        // Names this tab's live socket so the server can skip it when fanning
        // the change out — see `api/live.ts`.
        "X-Live-Client": liveClientId(),
      },
      signal: expect.any(AbortSignal),
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

  it("navigates to the login route on 403 (Cloudflare Access rejecting a dead session at the edge)", async () => {
    // Our own Worker never returns 403 — its auth failures are always 401
    // (server/src/middleware/auth.ts). A 403 only comes from Cloudflare
    // Access itself blocking a fetch/XHR request before it reaches the
    // Worker, which happens for the same reason a 401 does: the session is
    // gone. Confirmed against a real report — a child photo upload came back
    // "Request failed (HTTP 403)" right after a PUT to the same endpoint
    // succeeded, which is Access, not a validation failure in our own code.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    });

    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    expect(window.location.href).toBe("/api/auth/login?redirect=%2Ffeedings");
  });

  it("navigates to the login route on 403 from api.upload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    });

    await expect(api.upload("/children/1/photo", new FormData())).rejects.toThrow("Unauthorized");
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

  it("marks the screen stale when a request cannot reach the server", async () => {
    // Nothing caches API data, so a thrown fetch is the moment staleness
    // begins — and this catch block is the only code that sees it. The banner
    // and the retry loop both key off this flag.
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 1 }) });
    expect(getStaleSince()).toBeNull();

    await expect(api.get("/children")).rejects.toThrow(/network error/i);

    expect(getStaleSince()).not.toBeNull();
  });

  it("pingServer reports reachability without touching the stale flag", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(pingServer()).resolves.toBe(false);
    // The ping is a question, not a refresh attempt — a failed one must not
    // move the "stale since" clock the banner displays.
    expect(getStaleSince()).toBeNull();

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    await expect(pingServer()).resolves.toBe(true);
  });

  it("pingServer re-auths instead of retrying forever when Access rejects the probe with 403", async () => {
    // Without this, an expired session would make every ping "unreachable"
    // and the stale-data retry loop (client/src/hooks/useDataRefresh.tsx)
    // would poll every 15s forever, never sending the user back to log in.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() });

    await expect(pingServer()).resolves.toBe(false);
    expect(window.location.href).toBe("/api/auth/login?redirect=%2Ffeedings");
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

describe("Request deadlines and server errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    resetFreshness();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "", pathname: "/feedings", search: "" },
    });
  });

  it("gives every request a deadline", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve([]),
    });

    await api.get("/feedings");

    expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    timeoutSpy.mockRestore();
  });

  it("treats a request abandoned at its deadline as a lost connection", async () => {
    // What the deadline produces. Before it existed this state was
    // unreachable — the request simply stayed pending, so nothing marked the
    // screen stale and the retry loop never armed.
    const timedOut = new DOMException("The operation was aborted.", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timedOut).mockRejectedValueOnce(timedOut);

    await expect(api.get("/feedings")).rejects.toThrow();

    expect(getStaleSince()).not.toBeNull();
  });

  it("treats a 5xx as a failed refresh, not a fresh one", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "Internal server error" }),
    });

    await expect(api.get("/feedings")).rejects.toThrow();

    // The server answered, but with nothing — the screen still shows whatever
    // the last working refresh left there, so it is still stale.
    expect(getStaleSince()).not.toBeNull();
  });

  it("clears staleness on a 4xx, which still proves the server is reachable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "start_time is required" }),
    });

    await expect(api.post("/feedings", {})).rejects.toThrow("start_time is required");
    expect(getStaleSince()).toBeNull();
  });

  it("gives a generation request far longer than the CRUD deadline", async () => {
    // The bug this pins: the note refresh runs a model per child, which can
    // legitimately outlast 12s. Aborting it client-side surfaced as "Network
    // error" with nothing in the Cloudflare log — the Worker was still working,
    // and the live log only records a request once it completes.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ written: [] }),
    });

    await api.postSlow("/daily-notes/refresh", {});

    expect(timeoutSpy).toHaveBeenCalledWith(GENERATION_TIMEOUT_MS);
    expect(GENERATION_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    timeoutSpy.mockRestore();
  });

  it("does not let an optional request's 5xx mark the screen stale", async () => {
    // The regression this pins: the daily note is garnish, but its failure
    // used to raise the banner, which armed the 15s retry loop, which
    // refetched every mounted page — the "dashboard reloads a few times
    // after it loads" symptom. A .catch() at the call site cannot prevent
    // this; markOffline fires inside doFetch, before the caller sees it.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "Internal server error" }),
    });

    await expect(api.getOptional("/children/1/daily-note")).rejects.toThrow();

    expect(getStaleSince()).toBeNull();
  });

  it("does not let an optional request's dropped connection mark the screen stale", async () => {
    const timedOut = new DOMException("The operation was aborted.", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timedOut).mockRejectedValueOnce(timedOut);

    await expect(api.getOptional("/children/1/daily-note")).rejects.toThrow();

    expect(getStaleSince()).toBeNull();
  });

  it("still lets a required request mark the screen stale alongside an optional one", async () => {
    // The opt-out is per request, not a global mute.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "boom" }),
    });
    await expect(api.getOptional("/children/1/daily-note")).rejects.toThrow();
    expect(getStaleSince()).toBeNull();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "boom" }),
    });
    await expect(api.get("/feedings")).rejects.toThrow();
    expect(getStaleSince()).not.toBeNull();
  });

  it("recovers the banner state once a real response arrives", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve({ error: "unavailable" }),
    });
    await expect(api.get("/feedings")).rejects.toThrow();
    expect(getStaleSince()).not.toBeNull();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ date: new Date().toUTCString() }),
      json: () => Promise.resolve([]),
    });
    await api.get("/feedings");
    expect(getStaleSince()).toBeNull();
  });
});
