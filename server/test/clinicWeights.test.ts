import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, execScript } from "./helpers";
import clinicWeights from "../migrations/0012_add_clinic_weight_readings.sql?raw";

interface GrowthRow {
  date: string;
  weight: number | null;
  weight_unit: string | null;
  height: number | null;
  notes: string | null;
}

/** Every reading the migration backfills, oldest first. */
const READINGS = [
  { date: "2026-08-04", weight: 8.28 },
  { date: "2026-08-05", weight: 7.83 },
  { date: "2026-08-06", weight: 7.64 },
  { date: "2026-08-07", weight: 7.71 },
  { date: "2026-08-09", weight: 7.63 },
];

async function createChild(firstName: string): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO children (first_name, last_name, birth_date) VALUES (?, '', '2026-08-04') RETURNING id"
  )
    .bind(firstName)
    .first<{ id: number }>();
  return row!.id;
}

async function growthFor(childId: number): Promise<GrowthRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT date, weight, weight_unit, height, notes FROM growth WHERE child_id = ? ORDER BY date"
  )
    .bind(childId)
    .all<GrowthRow>();
  return results;
}

describe("0012_add_clinic_weight_readings", () => {
  beforeEach(async () => {
    // The migration runs here too, against a database with no children, which
    // is exactly the no-op case every fresh environment sees.
    await applyMigrations(env.DB);
  });

  it("records every reading in pounds against the matching child", async () => {
    const childId = await createChild("Nolan");

    await execScript(env.DB, clinicWeights);

    const rows = await growthFor(childId);
    expect(rows.map((r) => ({ date: r.date, weight: r.weight }))).toEqual(READINGS);
    expect(rows.every((r) => r.weight_unit === "lb")).toBe(true);
    expect(rows[4].notes).toBe("Clinic weigh-in, 9:03 AM");
  });

  it("fills in the weight on a reading day that already has a growth entry", async () => {
    const childId = await createChild("Nolan");
    await env.DB.prepare(
      "INSERT INTO growth (child_id, date, height, height_unit, notes) VALUES (?, '2026-08-04', 20.5, 'in', 'Birth measurements')"
    )
      .bind(childId)
      .run();

    await execScript(env.DB, clinicWeights);

    const rows = await growthFor(childId);
    expect(rows).toHaveLength(READINGS.length);
    // The existing entry gains the weight and keeps its height and its notes.
    expect(rows[0]).toMatchObject({
      date: "2026-08-04",
      weight: 8.28,
      weight_unit: "lb",
      height: 20.5,
      notes: "Birth measurements",
    });
  });

  it("leaves a weight that is already recorded alone, and re-running changes nothing", async () => {
    const childId = await createChild("Nolan");
    await env.DB.prepare(
      "INSERT INTO growth (child_id, date, weight, weight_unit) VALUES (?, '2026-08-05', 7.9, 'lb')"
    )
      .bind(childId)
      .run();

    await execScript(env.DB, clinicWeights);
    const firstRun = await growthFor(childId);
    await execScript(env.DB, clinicWeights);

    expect(await growthFor(childId)).toEqual(firstRun);
    expect(firstRun).toHaveLength(READINGS.length);
    expect(firstRun[1]).toMatchObject({ date: "2026-08-05", weight: 7.9 });
  });

  it("does not touch another child's growth entries", async () => {
    const otherId = await createChild("Emma");

    await execScript(env.DB, clinicWeights);

    expect(await growthFor(otherId)).toHaveLength(0);
  });
});
