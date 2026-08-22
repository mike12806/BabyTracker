import { describe, it, expect } from "vitest";
import { entryDetails, formatSpan, type ActivityFeedEntry } from "../src/utils/entryDetails";

function entry(overrides: Partial<ActivityFeedEntry> & { activity_type: string }): ActivityFeedEntry {
  return {
    event_time: "2024-12-01T09:00:00Z",
    detail: "",
    end_time: null,
    subtype: null,
    label: null,
    amount: null,
    amount_unit: null,
    color: null,
    ...overrides,
  };
}

describe("entryDetails", () => {
  it("names the feeding type and states the amount in the display unit", () => {
    const details = entryDetails(
      entry({ activity_type: "Feeding", subtype: "bottle_formula", amount: 4, amount_unit: "oz" }),
      "ml",
    );
    expect(details).toEqual({ label: "Bottle (Formula)", measure: "118 mL" });
  });

  it("falls back to a breastfeed's length when it recorded no amount", () => {
    const details = entryDetails(
      entry({
        activity_type: "Feeding",
        subtype: "breast_left",
        end_time: "2024-12-01T09:18:00Z",
      }),
      "oz",
    );
    expect(details).toEqual({ label: "Breast (Left)", measure: "18m" });
  });

  it("keeps a solid feeding's grams out of the volume conversion", () => {
    const details = entryDetails(
      entry({ activity_type: "Feeding", subtype: "solid", amount: 60, amount_unit: "g" }),
      "oz",
    );
    expect(details).toEqual({ label: "Solid Food", measure: "60 g" });
  });

  it("shows a diaper's type and colour", () => {
    expect(entryDetails(entry({ activity_type: "Diaper Change", subtype: "solid", color: "yellow" }), "ml")).toEqual({
      label: "Solid · Yellow",
      measure: null,
    });
    expect(entryDetails(entry({ activity_type: "Diaper Change", subtype: "wet" }), "ml")).toEqual({
      label: "Wet",
      measure: null,
    });
  });

  it("tells a finished sleep from one still going", () => {
    expect(
      entryDetails(
        entry({ activity_type: "Sleep", subtype: "nap", end_time: "2024-12-01T10:20:00Z" }),
        "ml",
      ),
    ).toEqual({ label: "Nap", measure: "1h 20m" });
    expect(entryDetails(entry({ activity_type: "Sleep", subtype: "night" }), "ml")).toEqual({
      label: "Night sleep",
      measure: "In progress",
    });
  });

  it("shows a pumping session's side and volume", () => {
    expect(
      entryDetails(
        entry({ activity_type: "Pumping", subtype: "both", amount: 3, amount_unit: "oz" }),
        "oz",
      ),
    ).toEqual({ label: "Both breasts", measure: "3 oz" });
  });

  it("carries the tummy time milestone and how long it lasted", () => {
    expect(
      entryDetails(
        entry({
          activity_type: "Tummy Time",
          label: "Rolled over",
          end_time: "2024-12-01T09:12:00Z",
        }),
        "ml",
      ),
    ).toEqual({ label: "Rolled over", measure: "12m" });
  });

  it("prints a temperature reading and a dose in the units they were recorded with", () => {
    expect(
      entryDetails(entry({ activity_type: "Temperature", amount: 98.6, amount_unit: "F" }), "ml"),
    ).toEqual({ label: "", measure: "98.6°F" });
    // A dose of medicine is never restated as ounces, whatever unit bottles
    // are being shown in.
    expect(
      entryDetails(
        entry({ activity_type: "Medication", label: "Vitamin D", amount: 1, amount_unit: "mL" }),
        "oz",
      ),
    ).toEqual({ label: "Vitamin D", measure: "1 mL" });
  });

  it("uses the note's title", () => {
    expect(entryDetails(entry({ activity_type: "Note", label: "First smile" }), "ml")).toEqual({
      label: "First smile",
      measure: null,
    });
  });

  it("falls back to the server's own summary when an entry has no details", () => {
    // A page cached before the API started sending the parts still reads
    // sensibly — that is the whole job of `detail`.
    expect(entryDetails({ activity_type: "Feeding", event_time: "2024-12-01T09:00:00Z", detail: "bottle formula" }, "ml")).toEqual({
      label: "Bottle formula",
      measure: null,
    });
  });
});

describe("formatSpan", () => {
  it("counts minutes, then hours and minutes", () => {
    expect(formatSpan("2024-12-01T09:00:00Z", "2024-12-01T09:45:00Z")).toBe("45m");
    expect(formatSpan("2024-12-01T09:00:00Z", "2024-12-01T11:00:00Z")).toBe("2h");
    expect(formatSpan("2024-12-01T09:00:00Z", "2024-12-01T11:05:00Z")).toBe("2h 5m");
  });

  it("has nothing to say about a span that never elapsed", () => {
    expect(formatSpan("2024-12-01T09:00:00Z", "2024-12-01T09:00:00Z")).toBeNull();
    expect(formatSpan("2024-12-01T09:00:00Z", "not a date")).toBeNull();
  });
});
