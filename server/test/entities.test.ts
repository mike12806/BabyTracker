import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Diaper Changes API", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);

    const res = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    childId = ((await res.json()) as { id: number }).id;
  });

  it("POST /api/diaper-changes creates a diaper change", async () => {
    const res = await api.post("/api/diaper-changes", {
      child_id: childId,
      time: "2024-12-01T09:00:00Z",
      type: "wet",
    });
    expect(res.status).toBe(201);
    const change = (await res.json()) as Record<string, unknown>;
    expect(change.type).toBe("wet");
  });

  it("GET /api/diaper-changes lists changes for a child", async () => {
    await api.post("/api/diaper-changes", {
      child_id: childId,
      time: "2024-12-01T09:00:00Z",
      type: "wet",
    });
    await api.post("/api/diaper-changes", {
      child_id: childId,
      time: "2024-12-01T12:00:00Z",
      type: "solid",
      color: "brown",
    });

    const res = await api.get(`/api/diaper-changes?child_id=${childId}`);
    expect(res.status).toBe(200);
    const changes = (await res.json()) as unknown[];
    expect(changes).toHaveLength(2);
  });

  it("POST /api/diaper-changes requires time and type", async () => {
    const res = await api.post("/api/diaper-changes", {
      child_id: childId,
    });
    expect(res.status).toBe(400);
  });
});

describe("Sleep API", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);

    const res = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    childId = ((await res.json()) as { id: number }).id;
  });

  it("POST /api/sleep creates a sleep entry", async () => {
    const res = await api.post("/api/sleep", {
      child_id: childId,
      start_time: "2024-12-01T20:00:00Z",
      end_time: "2024-12-02T06:00:00Z",
      is_nap: 0,
    });
    expect(res.status).toBe(201);
    const sleep = (await res.json()) as Record<string, unknown>;
    expect(sleep.is_nap).toBe(0);
  });

  it("GET /api/sleep lists sleep entries for a child", async () => {
    await api.post("/api/sleep", {
      child_id: childId,
      start_time: "2024-12-01T13:00:00Z",
      end_time: "2024-12-01T14:30:00Z",
      is_nap: 1,
    });

    const res = await api.get(`/api/sleep?child_id=${childId}`);
    expect(res.status).toBe(200);
    const entries = (await res.json()) as unknown[];
    expect(entries).toHaveLength(1);
  });
});
