import { describe, it, expect } from "vitest";
import {
  DEVELOPMENTAL_MILESTONES,
  MILESTONE_DOMAINS,
  RECENT_CHECKPOINT_GRACE_DAYS,
  checkpointDate,
  checkpointItems,
  compactGap,
  describeGap,
  focusCheckpoint,
  milestoneOfTheDay,
} from "../src/utils/milestones";

// Local-time noon, so no test depends on the machine's timezone.
const at = (ymd: string) => new Date(`${ymd}T12:00:00`);

describe("milestone data", () => {
  it("covers the CDC checkpoints in age order, 2 months to 5 years", () => {
    expect(DEVELOPMENTAL_MILESTONES.map((c) => c.months)).toEqual([2, 4, 6, 9, 12, 15, 18, 24, 30, 36, 48, 60]);
  });

  it("cites a CDC page for every checkpoint", () => {
    for (const checkpoint of DEVELOPMENTAL_MILESTONES) {
      expect(checkpoint.sourceUrl).toMatch(/^https:\/\/www\.cdc\.gov\/act-early\/milestones\/[\w-]+\.html$/);
    }
    // One page per checkpoint: a copy-paste slip would cite the wrong age.
    expect(new Set(DEVELOPMENTAL_MILESTONES.map((c) => c.sourceUrl)).size).toBe(DEVELOPMENTAL_MILESTONES.length);
  });

  it("has something in every domain, with no item listed twice", () => {
    for (const checkpoint of DEVELOPMENTAL_MILESTONES) {
      for (const domain of MILESTONE_DOMAINS) {
        expect(checkpoint.items[domain].length, `${checkpoint.label} ${domain}`).toBeGreaterThan(0);
      }
      const items = checkpointItems(checkpoint);
      expect(new Set(items).size, checkpoint.label).toBe(items.length);
    }
  });

  it("does not assume the child's pronouns", () => {
    for (const item of DEVELOPMENTAL_MILESTONES.flatMap(checkpointItems)) {
      expect(item).not.toMatch(/\b(he|she|him|his|her|hers|himself|herself)\b/i);
    }
  });
});

describe("checkpointDate", () => {
  it("lands on the same day of the month", () => {
    expect(checkpointDate(new Date(2026, 3, 7), 4)).toEqual(new Date(2026, 7, 7));
  });

  it("clamps to the end of a shorter month, like the hero's monthly badge", () => {
    expect(checkpointDate(new Date(2025, 11, 31), 2)).toEqual(new Date(2026, 1, 28));
  });
});

describe("focusCheckpoint", () => {
  const birth = "2026-04-07";

  it("points a newborn at the 2-month checkpoint", () => {
    const focus = focusCheckpoint(birth, at("2026-04-07"));
    expect(focus?.checkpoint.label).toBe("2 months");
    expect(focus?.daysUntil).toBe(61);
  });

  it("keeps a checkpoint in focus for two weeks after it is reached", () => {
    expect(focusCheckpoint(birth, at("2026-06-07"))).toMatchObject({ daysUntil: 0, checkpoint: { label: "2 months" } });
    expect(focusCheckpoint(birth, at("2026-06-21"))).toMatchObject({
      daysUntil: -RECENT_CHECKPOINT_GRACE_DAYS,
      checkpoint: { label: "2 months" },
    });
  });

  it("moves on to the next checkpoint once the grace period is over", () => {
    const focus = focusCheckpoint(birth, at("2026-06-22"));
    expect(focus?.checkpoint.label).toBe("4 months");
    expect(focus?.daysUntil).toBe(46);
  });

  it("names the first birthday as 1 year", () => {
    expect(focusCheckpoint(birth, at("2027-02-01"))?.checkpoint.label).toBe("1 year");
  });

  it("ignores the time of day", () => {
    const morning = focusCheckpoint(birth, new Date("2026-07-01T00:05:00"));
    const night = focusCheckpoint(birth, new Date("2026-07-01T23:55:00"));
    expect(morning).toEqual(night);
  });

  it("stops after the 5-year checkpoint's grace period", () => {
    expect(focusCheckpoint(birth, at("2031-04-21"))?.checkpoint.label).toBe("5 years");
    expect(focusCheckpoint(birth, at("2031-04-22"))).toBeNull();
  });

  it("has nothing to say before birth or without a birth date", () => {
    expect(focusCheckpoint("2026-12-01", at("2026-09-28"))).toBeNull();
    expect(focusCheckpoint("", at("2026-09-28"))).toBeNull();
  });
});

describe("milestoneOfTheDay", () => {
  const checkpoint = DEVELOPMENTAL_MILESTONES[1];

  it("is the same all day, so a refresh doesn't change it", () => {
    expect(milestoneOfTheDay(checkpoint, new Date("2026-07-01T00:05:00"))).toBe(
      milestoneOfTheDay(checkpoint, new Date("2026-07-01T23:55:00")),
    );
  });

  it("changes from one day to the next", () => {
    expect(milestoneOfTheDay(checkpoint, at("2026-07-01"))).not.toBe(milestoneOfTheDay(checkpoint, at("2026-07-02")));
  });

  it("works through every item in the checkpoint", () => {
    const items = checkpointItems(checkpoint);
    const seen = new Set(
      Array.from({ length: items.length }, (_, i) => milestoneOfTheDay(checkpoint, new Date(2026, 6, 1 + i, 12))),
    );
    expect(seen).toEqual(new Set(items));
  });
});

describe("gap labels", () => {
  it("describes a checkpoint from today", () => {
    expect(describeGap(0)).toBe("today");
    expect(describeGap(1)).toBe("tomorrow");
    expect(describeGap(5)).toBe("in 5 days");
    expect(describeGap(37)).toBe("in 5 weeks");
    expect(describeGap(120)).toBe("in 4 months");
    expect(describeGap(-1)).toBe("yesterday");
    expect(describeGap(-12)).toBe("12 days ago");
    expect(describeGap(-800)).toBe("2 years ago");
  });

  it("keeps the dashboard row short", () => {
    expect(compactGap(-3)).toBe("now");
    expect(compactGap(0)).toBe("now");
    expect(compactGap(1)).toBe("tomorrow");
    expect(compactGap(9)).toBe("in 9 days");
    expect(compactGap(37)).toBe("in 5 wks");
    expect(compactGap(92)).toBe("in 3 mo");
  });
});
