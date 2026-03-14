import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Auth API", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("GET /api/auth/me returns current user", async () => {
    const res = await api.get("/api/auth/me");
    expect(res.status).toBe(200);
    const user = (await res.json()) as Record<string, unknown>;
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
    expect(user.id).toBeDefined();
  });

  it("auto-creates user on first request", async () => {
    const res = await api.get("/api/auth/me", {
      "X-Test-Email": "newuser@example.com",
      "X-Test-Name": "New User",
    });
    expect(res.status).toBe(200);
    const user = (await res.json()) as Record<string, unknown>;
    expect(user.email).toBe("newuser@example.com");
    expect(user.name).toBe("New User");
  });
});

describe("Access Control", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("users cannot see other users' children", async () => {
    // User A creates a child
    const createRes = await api.post(
      "/api/children",
      { first_name: "Emma", birth_date: "2024-06-15" },
      { "X-Test-Email": "userA@example.com" }
    );
    const child = (await createRes.json()) as { id: number };

    // User B cannot see the child
    const getRes = await api.get(`/api/children/${child.id}`, {
      "X-Test-Email": "userB@example.com",
    });
    expect(getRes.status).toBe(404);
  });

  it("users cannot access feedings for other users' children", async () => {
    // User A creates a child
    const createRes = await api.post(
      "/api/children",
      { first_name: "Emma", birth_date: "2024-06-15" },
      { "X-Test-Email": "userA@example.com" }
    );
    const child = (await createRes.json()) as { id: number };

    // User B cannot list feedings for that child
    const feedingsRes = await api.get(`/api/feedings?child_id=${child.id}`, {
      "X-Test-Email": "userB@example.com",
    });
    expect(feedingsRes.status).toBe(404);
  });

  it("users cannot create feedings for other users' children", async () => {
    // User A creates a child
    const createRes = await api.post(
      "/api/children",
      { first_name: "Emma", birth_date: "2024-06-15" },
      { "X-Test-Email": "userA@example.com" }
    );
    const child = (await createRes.json()) as { id: number };

    // User B cannot create a feeding for that child
    const feedingRes = await api.post(
      "/api/feedings",
      { child_id: child.id, type: "bottle", start_time: "2024-12-01T08:00:00Z" },
      { "X-Test-Email": "userB@example.com" }
    );
    expect(feedingRes.status).toBe(404);
  });
});
