import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Settings API", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("GET /api/settings returns default settings", async () => {
    const res = await api.get("/api/settings");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.default_child_id).toBeNull();
    expect(data.theme_mode).toBe("system");
  });

  it("PUT /api/settings updates theme_mode", async () => {
    const res = await api.put("/api/settings", { theme_mode: "dark" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.theme_mode).toBe("dark");
  });

  it("PUT /api/settings updates default_child_id", async () => {
    // Create a child first
    const childRes = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    const child = (await childRes.json()) as { id: number };

    const res = await api.put("/api/settings", { default_child_id: child.id });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.default_child_id).toBe(child.id);
  });

  it("PUT /api/settings rejects invalid default_child_id", async () => {
    const res = await api.put("/api/settings", { default_child_id: 999 });
    expect(res.status).toBe(404);
  });

  it("PUT /api/settings rejects invalid theme_mode", async () => {
    const res = await api.put("/api/settings", { theme_mode: "neon" });
    expect(res.status).toBe(400);
  });

  it("PUT /api/settings can clear default_child_id", async () => {
    // Create a child and set as default
    const childRes = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    const child = (await childRes.json()) as { id: number };
    await api.put("/api/settings", { default_child_id: child.id });

    // Clear it
    const res = await api.put("/api/settings", { default_child_id: null });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.default_child_id).toBeNull();
  });

  it("GET /api/settings persists across requests", async () => {
    await api.put("/api/settings", { theme_mode: "light" });
    const res = await api.get("/api/settings");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.theme_mode).toBe("light");
  });

  it("settings cannot reference another user's child", async () => {
    // User A creates a child
    const childRes = await api.post(
      "/api/children",
      { first_name: "Emma", birth_date: "2024-06-15" },
      { "X-Test-Email": "userA@example.com" }
    );
    const child = (await childRes.json()) as { id: number };

    // User B tries to set it as default
    const res = await api.put(
      "/api/settings",
      { default_child_id: child.id },
      { "X-Test-Email": "userB@example.com" }
    );
    expect(res.status).toBe(404);
  });
});
