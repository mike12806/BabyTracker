import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

interface ActivityEntry {
  id: number;
  activity_type: string;
  event_time: string;
}

interface ActivityResponse {
  total: number;
  offset: number;
  limit: number;
  results: ActivityEntry[];
}

/**
 * The feed merges eight tables. Each query is capped at `offset + limit` rows,
 * so these check the cap can't change what a page contains — the merge is of
 * lists that are already ordered, so a row past that cut in its own table
 * could never have placed inside the page anyway.
 */
describe("Activity paging", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  const at = (day: number, hour: number) =>
    `2026-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);

    const res = await api.post("/api/children", { first_name: "Nolan", birth_date: "2026-01-04" });
    childId = ((await res.json()) as { id: number }).id;
  });

  async function get(query: string): Promise<ActivityResponse> {
    const res = await api.get(`/api/activity?child_id=${childId}&${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as ActivityResponse;
  }

  it("returns the newest entries first, across every source table", async () => {
    // Interleaved so no single table holds the whole page.
    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(1, 10) });
    await api.post("/api/diaper-changes", { child_id: childId, time: at(1, 12), type: "wet" });
    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(1, 14) });
    await api.post("/api/sleep", { child_id: childId, start_time: at(1, 16), is_nap: 1 });

    const page = await get("limit=2&offset=0");

    expect(page.results.map((e) => e.event_time)).toEqual([at(1, 16), at(1, 14)]);
    expect(page.total).toBe(4);
  });

  it("keeps a later page correct even though each query is capped", async () => {
    // Fifteen feedings, deliberately more than one page, plus a diaper change
    // older than all of them. The cap has to be `offset + limit`, not `limit`:
    // capping at `limit` would fetch only the ten newest feedings, and page two
    // would lose the five that belong at its top.
    for (let hour = 0; hour < 15; hour++) {
      await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(2, hour) });
    }
    await api.post("/api/diaper-changes", { child_id: childId, time: at(1, 1), type: "wet" });

    const first = await get("limit=10&offset=0");
    const second = await get("limit=10&offset=10");

    expect(first.results.map((e) => e.event_time)).toEqual(
      [14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((hour) => at(2, hour))
    );
    expect(second.results.map((e) => e.event_time)).toEqual([
      ...[4, 3, 2, 1, 0].map((hour) => at(2, hour)),
      at(1, 1),
    ]);
    expect(second.total).toBe(16);
  });

  it("counts everything in range, not just the rows the page needed", async () => {
    for (let hour = 10; hour < 18; hour++) {
      await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(3, hour) });
    }
    await api.post("/api/notes", { child_id: childId, time: at(3, 9), content: "slept well" });

    // The pager renders "Page X of Y" from this, so it has to reflect the whole
    // range rather than the capped slice the page was built from.
    const page = await get("limit=2&offset=0");
    expect(page.results).toHaveLength(2);
    expect(page.total).toBe(9);
  });

  it("honours the date filter in both the page and the count", async () => {
    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(1, 10) });
    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(5, 10) });
    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(9, 10) });

    const page = await get(`limit=50&offset=0&date_from=${at(4, 0)}&date_to=${at(6, 0)}`);

    expect(page.total).toBe(1);
    expect(page.results.map((e) => e.event_time)).toEqual([at(5, 10)]);
  });

  it("does not leak another child's entries into the count", async () => {
    const other = ((await (
      await api.post("/api/children", { first_name: "Mikey", birth_date: "2026-01-04" })
    ).json()) as { id: number }).id;

    await api.post("/api/feedings", { child_id: childId, type: "bottle_formula", start_time: at(4, 10) });
    await api.post("/api/feedings", { child_id: other, type: "bottle_formula", start_time: at(4, 11) });

    const page = await get("limit=50&offset=0");

    expect(page.total).toBe(1);
    expect(page.results).toHaveLength(1);
  });

  it("returns an empty page rather than failing when there is nothing to show", async () => {
    const page = await get("limit=50&offset=0");
    expect(page.total).toBe(0);
    expect(page.results).toEqual([]);
  });
});
