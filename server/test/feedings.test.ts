import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Feedings API", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);

    // Create a child for feeding tests
    const res = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    childId = ((await res.json()) as { id: number }).id;
  });

  it("GET /api/feedings returns empty list initially", async () => {
    const res = await api.get(`/api/feedings?child_id=${childId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("POST /api/feedings creates a feeding", async () => {
    const res = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle",
      start_time: "2024-12-01T08:00:00Z",
      end_time: "2024-12-01T08:20:00Z",
      amount: 4,
      amount_unit: "oz",
      notes: "Morning bottle",
    });
    expect(res.status).toBe(201);
    const feeding = (await res.json()) as Record<string, unknown>;
    expect(feeding.type).toBe("bottle");
    expect(feeding.amount).toBe(4);
    expect(feeding.amount_unit).toBe("oz");
    expect(feeding.notes).toBe("Morning bottle");
  });

  it("GET /api/feedings lists feedings for a child", async () => {
    await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle",
      start_time: "2024-12-01T08:00:00Z",
    });
    await api.post("/api/feedings", {
      child_id: childId,
      type: "breast_left",
      start_time: "2024-12-01T10:00:00Z",
    });

    const res = await api.get(`/api/feedings?child_id=${childId}`);
    expect(res.status).toBe(200);
    const feedings = (await res.json()) as unknown[];
    expect(feedings).toHaveLength(2);
  });

  it("PUT /api/feedings/:id updates a feeding", async () => {
    const createRes = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle",
      start_time: "2024-12-01T08:00:00Z",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.put(`/api/feedings/${created.id}`, {
      amount: 6,
      amount_unit: "oz",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.amount).toBe(6);
  });

  it("DELETE /api/feedings/:id deletes a feeding", async () => {
    const createRes = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle",
      start_time: "2024-12-01T08:00:00Z",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.delete(`/api/feedings/${created.id}`);
    expect(res.status).toBe(200);

    const listRes = await api.get(`/api/feedings?child_id=${childId}`);
    const feedings = (await listRes.json()) as unknown[];
    expect(feedings).toHaveLength(0);
  });

  it("POST /api/feedings requires type and start_time", async () => {
    const res = await api.post("/api/feedings", {
      child_id: childId,
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/feedings returns 404 for unauthorized child", async () => {
    const res = await api.get("/api/feedings?child_id=999");
    expect(res.status).toBe(404);
  });
});
