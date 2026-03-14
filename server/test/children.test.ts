import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Children API", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("GET /api/children returns empty list initially", async () => {
    const res = await api.get("/api/children");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("POST /api/children creates a child", async () => {
    const res = await api.post("/api/children", {
      first_name: "Emma",
      last_name: "Smith",
      birth_date: "2024-06-15",
    });
    expect(res.status).toBe(201);
    const child = (await res.json()) as Record<string, unknown>;
    expect(child.first_name).toBe("Emma");
    expect(child.last_name).toBe("Smith");
    expect(child.birth_date).toBe("2024-06-15");
    expect(child.id).toBeDefined();
  });

  it("GET /api/children returns created children", async () => {
    await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    await api.post("/api/children", {
      first_name: "Liam",
      birth_date: "2025-01-10",
    });

    const res = await api.get("/api/children");
    expect(res.status).toBe(200);
    const children = (await res.json()) as unknown[];
    expect(children).toHaveLength(2);
  });

  it("GET /api/children/:id returns a specific child", async () => {
    const createRes = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.get(`/api/children/${created.id}`);
    expect(res.status).toBe(200);
    const child = (await res.json()) as Record<string, unknown>;
    expect(child.first_name).toBe("Emma");
  });

  it("PUT /api/children/:id updates a child", async () => {
    const createRes = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.put(`/api/children/${created.id}`, {
      first_name: "Emily",
    });
    expect(res.status).toBe(200);
    const child = (await res.json()) as Record<string, unknown>;
    expect(child.first_name).toBe("Emily");
  });

  it("DELETE /api/children/:id deletes a child", async () => {
    const createRes = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.delete(`/api/children/${created.id}`);
    expect(res.status).toBe(200);

    const listRes = await api.get("/api/children");
    const children = (await listRes.json()) as unknown[];
    expect(children).toHaveLength(0);
  });

  it("POST /api/children requires first_name and birth_date", async () => {
    const res = await api.post("/api/children", { last_name: "Smith" });
    expect(res.status).toBe(400);
  });

  it("GET /api/children/:id returns 404 for nonexistent child", async () => {
    const res = await api.get("/api/children/999");
    expect(res.status).toBe(404);
  });
});
