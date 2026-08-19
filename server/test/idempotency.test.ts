import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";
import { pruneClientRequests } from "../src/routes/idempotency";

describe("Idempotent creates", () => {
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

  const feeding = (client_request_id?: string) => ({
    child_id: childId,
    type: "bottle_formula",
    start_time: "2024-12-01T09:00:00Z",
    amount: 120,
    amount_unit: "ml",
    ...(client_request_id ? { client_request_id } : {}),
  });

  it("creates one row when the same key is sent twice", async () => {
    const first = await api.post("/api/feedings", feeding("key-abc"));
    const second = await api.post("/api/feedings", feeding("key-abc"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = (await first.json()) as { id: number };
    const secondBody = (await second.json()) as { id: number };
    expect(secondBody.id).toBe(firstBody.id);

    const list = (await (await api.get(`/api/feedings?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("creates two rows for two different keys", async () => {
    await api.post("/api/feedings", feeding("key-1"));
    await api.post("/api/feedings", feeding("key-2"));

    const list = (await (await api.get(`/api/feedings?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("still creates a row for every request when no key is sent", async () => {
    // The installed PWA updates on its own schedule, so a client that knows
    // nothing about keys has to keep behaving exactly as it did.
    await api.post("/api/feedings", feeding());
    await api.post("/api/feedings", feeding());

    const list = (await (await api.get(`/api/feedings?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("deduplicates concurrent requests carrying the same key", async () => {
    // Both requests pass the "has this key been used?" lookup before either
    // writes, so only the unique index can separate them.
    const [a, b] = await Promise.all([
      api.post("/api/feedings", feeding("race-key")),
      api.post("/api/feedings", feeding("race-key")),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const list = (await (await api.get(`/api/feedings?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("scopes keys per table, so the same key creates one row in each", async () => {
    await api.post("/api/feedings", feeding("shared-key"));
    const diaper = await api.post("/api/diaper-changes", {
      child_id: childId,
      time: "2024-12-01T09:05:00Z",
      type: "wet",
      client_request_id: "shared-key",
    });

    expect(diaper.status).toBe(201);
    const diapers = (await (
      await api.get(`/api/diaper-changes?child_id=${childId}`)
    ).json()) as unknown[];
    expect(diapers).toHaveLength(1);
  });

  it("does not resurrect an entry deleted after its key was claimed", async () => {
    const created = (await (await api.post("/api/feedings", feeding("gone-key"))).json()) as {
      id: number;
    };
    await api.delete(`/api/feedings/${created.id}`);

    const replay = await api.post("/api/feedings", feeding("gone-key"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ deleted: true });

    const list = (await (await api.get(`/api/feedings?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("ignores a malformed key rather than failing the entry", async () => {
    const res = await api.post("/api/feedings", {
      ...feeding(),
      client_request_id: "  ",
    });
    expect(res.status).toBe(201);
  });

  it("never writes a key without the row it points at", async () => {
    // A required column is missing, so the insert fails and the batch rolls
    // back. If the claim survived it, the user's next attempt with the same key
    // would be answered with a row that does not exist.
    const res = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      client_request_id: "rolled-back",
    });
    expect(res.status).toBe(400);

    const claim = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM client_requests WHERE client_request_id = ?"
    )
      .bind("rolled-back")
      .first<{ n: number }>();
    expect(claim?.n).toBe(0);
  });

  it("deduplicates timers", async () => {
    await api.post("/api/timers", { child_id: childId, name: "Nap", client_request_id: "t-1" });
    await api.post("/api/timers", { child_id: childId, name: "Nap", client_request_id: "t-1" });

    const list = (await (await api.get(`/api/timers?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("deduplicates todos", async () => {
    await api.post("/api/todos", { child_id: childId, title: "Book check-up", client_request_id: "d-1" });
    await api.post("/api/todos", { child_id: childId, title: "Book check-up", client_request_id: "d-1" });

    const list = (await (await api.get(`/api/todos?child_id=${childId}`)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("deduplicates children and links the survivor exactly once", async () => {
    const first = await api.post("/api/children", {
      first_name: "Noah",
      birth_date: "2025-01-02",
      client_request_id: "c-1",
    });
    const second = await api.post("/api/children", {
      first_name: "Noah",
      birth_date: "2025-01-02",
      client_request_id: "c-1",
    });

    const firstBody = (await first.json()) as { id: number };
    const secondBody = (await second.json()) as { id: number };
    expect(secondBody.id).toBe(firstBody.id);

    const links = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_children WHERE child_id = ?"
    )
      .bind(firstBody.id)
      .first<{ n: number }>();
    expect(links?.n).toBe(1);
  });

  it("links every created child to its creator", async () => {
    // The child row and the link are one batch; this is the invariant that
    // buys — a child that exists but belongs to nobody is invisible in the app.
    const created = (await (
      await api.post("/api/children", { first_name: "Ada", birth_date: "2025-03-03" })
    ).json()) as { id: number };

    const link = await env.DB.prepare(
      "SELECT user_id FROM user_children WHERE child_id = ?"
    )
      .bind(created.id)
      .first<{ user_id: number }>();
    expect(link).not.toBeNull();
  });

  it("prunes keys older than the retry window and keeps recent ones", async () => {
    await api.post("/api/feedings", feeding("fresh"));
    await env.DB.prepare(
      "INSERT INTO client_requests (user_id, table_name, client_request_id, row_id, created_at) VALUES (1, 'feedings', 'ancient', 1, '2020-01-01T00:00:00Z')"
    ).run();

    const removed = await pruneClientRequests(env.DB, 7);
    expect(removed).toBe(1);

    const remaining = await env.DB.prepare(
      "SELECT client_request_id FROM client_requests"
    ).all<{ client_request_id: string }>();
    expect(remaining.results.map((r) => r.client_request_id)).toEqual(["fresh"]);
  });
});
