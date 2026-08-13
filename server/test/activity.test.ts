import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

interface ActivityEntry {
  id: number;
  activity_type: string;
  event_time: string;
  detail: string;
}

interface ActivityResponse {
  total: number;
  offset: number;
  limit: number;
  results: ActivityEntry[];
}

describe("Activity API", () => {
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

  it("returns the source row id for every activity type", async () => {
    // One entry per type that appears in the feed, so a tap on any of them can
    // be resolved back to the record it came from.
    const created: Record<string, number> = {};
    const seed = async (path: string, body: Record<string, unknown>, key: string) => {
      const res = await api.post(path, { child_id: childId, ...body });
      expect(res.status).toBe(201);
      created[key] = ((await res.json()) as { id: number }).id;
    };

    await seed("/api/feedings", { type: "bottle_formula", start_time: "2024-12-01T09:00:00Z", amount: 4, amount_unit: "oz" }, "Feeding");
    await seed("/api/diaper-changes", { time: "2024-12-01T09:30:00Z", type: "wet" }, "Diaper Change");
    await seed("/api/sleep", { start_time: "2024-12-01T10:00:00Z", is_nap: 1 }, "Sleep");
    await seed("/api/tummy-time", { start_time: "2024-12-01T11:00:00Z" }, "Tummy Time");
    await seed("/api/pumping", { start_time: "2024-12-01T12:00:00Z", amount: 3, amount_unit: "oz" }, "Pumping");
    await seed("/api/temperature", { time: "2024-12-01T13:00:00Z", reading: 98.6, reading_unit: "F" }, "Temperature");
    await seed("/api/notes", { time: "2024-12-01T14:00:00Z", content: "First smile" }, "Note");
    await seed("/api/medications", { time: "2024-12-01T15:00:00Z", name: "Vitamin D" }, "Medication");

    const res = await api.get(`/api/activity?child_id=${childId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityResponse;
    expect(body.total).toBe(8);

    for (const [activityType, id] of Object.entries(created)) {
      const entry = body.results.find((e) => e.activity_type === activityType);
      expect(entry, `missing ${activityType} in feed`).toBeDefined();
      expect(entry!.id).toBe(id);
    }
  });

  it("keeps ids attached to the right entry when several share a type", async () => {
    const first = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-12-01T09:00:00Z",
      amount: 4,
      amount_unit: "oz",
    });
    const firstId = ((await first.json()) as { id: number }).id;

    const second = await api.post("/api/feedings", {
      child_id: childId,
      type: "solid",
      start_time: "2024-12-01T17:00:00Z",
    });
    const secondId = ((await second.json()) as { id: number }).id;

    const res = await api.get(`/api/activity?child_id=${childId}`);
    const body = (await res.json()) as ActivityResponse;

    // Feed is reverse-chronological, so the later feeding comes first.
    expect(body.results.map((e) => e.id)).toEqual([secondId, firstId]);
  });

  it("serves a user with no user_children row for the child", async () => {
    // The child was created by the default test user, so only that user gets a
    // `user_children` row. A second user sees this child in `GET /api/children`
    // and can read every other endpoint for it, so the feed must load too —
    // requiring the link row here was the one thing that 404'd, leaving the
    // page stuck on "No activity yet" while the rest of the app worked.
    await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-12-01T09:00:00Z",
      amount: 4,
      amount_unit: "oz",
    });

    const res = await api.get(`/api/activity?child_id=${childId}`, {
      "X-Test-Email": "coparent@example.com",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityResponse;
    expect(body.total).toBe(1);
    expect(body.results).toHaveLength(1);
  });

  it("still 404s for a child that does not exist", async () => {
    const res = await api.get(`/api/activity?child_id=${childId + 999}`);
    expect(res.status).toBe(404);
  });
});
