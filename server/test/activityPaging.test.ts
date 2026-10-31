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

  /**
   * Seeds entries straight into D1 in one batch. These tests are about how the
   * feed pages what is already stored, not about the create routes (which have
   * their own tests), and posting each row through the API was slow enough on
   * the CI runner pods to push the larger cases past the test timeout.
   */
  type Seed =
    | { table: "feedings"; childId?: number; time: string }
    | { table: "diaper_changes"; time: string }
    | { table: "sleep"; time: string }
    | { table: "notes"; time: string; content: string };

  async function seed(...rows: Seed[]): Promise<void> {
    await env.DB.batch(
      rows.map((row) => {
        switch (row.table) {
          case "feedings":
            return env.DB.prepare("INSERT INTO feedings (child_id, type, start_time) VALUES (?, 'bottle_formula', ?)").bind(
              row.childId ?? childId,
              row.time
            );
          case "diaper_changes":
            return env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (?, ?, 'wet')").bind(
              childId,
              row.time
            );
          case "sleep":
            return env.DB.prepare("INSERT INTO sleep (child_id, start_time, is_nap) VALUES (?, ?, 1)").bind(
              childId,
              row.time
            );
          case "notes":
            return env.DB.prepare("INSERT INTO notes (child_id, time, content) VALUES (?, ?, ?)").bind(
              childId,
              row.time,
              row.content
            );
        }
      })
    );
  }

  const feeding = (time: string, child?: number): Seed => ({ table: "feedings", childId: child, time });

  async function get(query: string): Promise<ActivityResponse> {
    const res = await api.get(`/api/activity?child_id=${childId}&${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as ActivityResponse;
  }

  it("returns the newest entries first, across every source table", async () => {
    // Interleaved so no single table holds the whole page.
    await seed(
      feeding(at(1, 10)),
      { table: "diaper_changes", time: at(1, 12) },
      feeding(at(1, 14)),
      { table: "sleep", time: at(1, 16) }
    );

    const page = await get("limit=2&offset=0");

    expect(page.results.map((e) => e.event_time)).toEqual([at(1, 16), at(1, 14)]);
    expect(page.total).toBe(4);
  });

  it("keeps a later page correct even though each query is capped", async () => {
    // Fifteen feedings, deliberately more than one page, plus a diaper change
    // older than all of them. The cap has to be `offset + limit`, not `limit`:
    // capping at `limit` would fetch only the ten newest feedings, and page two
    // would lose the five that belong at its top.
    await seed(
      ...Array.from({ length: 15 }, (_, hour) => feeding(at(2, hour))),
      { table: "diaper_changes", time: at(1, 1) }
    );

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
    await seed(
      ...Array.from({ length: 8 }, (_, i) => feeding(at(3, 10 + i))),
      { table: "notes", time: at(3, 9), content: "slept well" }
    );

    // The pager renders "Page X of Y" from this, so it has to reflect the whole
    // range rather than the capped slice the page was built from.
    const page = await get("limit=2&offset=0");
    expect(page.results).toHaveLength(2);
    expect(page.total).toBe(9);
  });

  it("honours the date filter in both the page and the count", async () => {
    await seed(feeding(at(1, 10)), feeding(at(5, 10)), feeding(at(9, 10)));

    const page = await get(`limit=50&offset=0&date_from=${at(4, 0)}&date_to=${at(6, 0)}`);

    expect(page.total).toBe(1);
    expect(page.results.map((e) => e.event_time)).toEqual([at(5, 10)]);
  });

  it("does not leak another child's entries into the count", async () => {
    const other = ((await (
      await api.post("/api/children", { first_name: "Mikey", birth_date: "2026-01-04" })
    ).json()) as { id: number }).id;

    await seed(feeding(at(4, 10)), feeding(at(4, 11), other));

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
