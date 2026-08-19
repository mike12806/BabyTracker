import { describe, it, expect } from "vitest";
import {
  boopMessage,
  childPhotoUrl,
  daysOld,
  detailedAge,
  greeting,
  milestone,
  parseBirthDate,
} from "../src/utils/childMoments";
import type { Child } from "../src/types/models";

const at = (iso: string) => new Date(iso);

describe("parseBirthDate", () => {
  it("reads a plain date as local midnight, not UTC", () => {
    const parsed = parseBirthDate("2026-04-07")!;
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(3);
    expect(parsed.getDate()).toBe(7);
    expect(parsed.getHours()).toBe(0);
  });

  it("tolerates a stored timestamp", () => {
    expect(parseBirthDate("2026-04-07T00:00:00Z")!.getDate()).toBe(7);
  });

  it("returns null for junk", () => {
    expect(parseBirthDate("")).toBeNull();
    expect(parseBirthDate("not a date")).toBeNull();
  });
});

describe("daysOld", () => {
  it("counts calendar days, ignoring the time of day", () => {
    expect(daysOld("2026-04-07", at("2026-04-07T23:30:00"))).toBe(0);
    expect(daysOld("2026-04-07", at("2026-04-08T00:05:00"))).toBe(1);
    expect(daysOld("2026-04-07", at("2026-05-07T09:00:00"))).toBe(30);
  });

  it("never goes negative for a future date", () => {
    expect(daysOld("2027-01-01", at("2026-04-07T09:00:00"))).toBe(0);
  });
});

describe("detailedAge", () => {
  it("counts in days for the first fortnight", () => {
    expect(detailedAge("2026-04-07", at("2026-04-07T10:00:00"))).toBe("born today");
    expect(detailedAge("2026-04-07", at("2026-04-08T10:00:00"))).toBe("1 day old");
    expect(detailedAge("2026-04-07", at("2026-04-17T10:00:00"))).toBe("10 days old");
  });

  it("counts in weeks up to three months", () => {
    expect(detailedAge("2026-04-07", at("2026-04-21T10:00:00"))).toBe("2 weeks old");
    expect(detailedAge("2026-04-07", at("2026-04-24T10:00:00"))).toBe("2 weeks, 3 days old");
  });

  it("counts in months and days through the second year", () => {
    expect(detailedAge("2026-04-07", at("2026-08-07T10:00:00"))).toBe("4 months old");
    expect(detailedAge("2026-04-07", at("2026-08-19T10:00:00"))).toBe("4 months, 12 days old");
  });

  it("counts in years and months from two", () => {
    expect(detailedAge("2024-04-07", at("2026-04-07T10:00:00"))).toBe("2 years old");
    expect(detailedAge("2024-04-07", at("2026-07-09T10:00:00"))).toBe("2 years, 3 months old");
  });

  it("handles a birth date that is still ahead", () => {
    expect(detailedAge("2027-01-01", at("2026-04-07T10:00:00"))).toBe("on the way");
  });

  it("is empty rather than wrong when the date is unreadable", () => {
    expect(detailedAge("", at("2026-04-07T10:00:00"))).toBe("");
  });
});

describe("greeting", () => {
  it("does not wish a good morning to someone up at 3am", () => {
    expect(greeting(at("2026-04-07T03:00:00"))).toBe("Still up");
  });

  it("tracks the rest of the day", () => {
    expect(greeting(at("2026-04-07T08:00:00"))).toBe("Good morning");
    expect(greeting(at("2026-04-07T13:00:00"))).toBe("Good afternoon");
    expect(greeting(at("2026-04-07T19:00:00"))).toBe("Good evening");
    expect(greeting(at("2026-04-07T23:00:00"))).toBe("Late one tonight");
  });
});

describe("milestone", () => {
  it("marks the day he was born", () => {
    expect(milestone("2026-04-07", at("2026-04-07T09:00:00"))).toEqual({
      label: "Welcome to the world",
      emoji: "🌟",
    });
  });

  it("marks weekly turns only through the newborn stretch", () => {
    expect(milestone("2026-04-07", at("2026-04-28T09:00:00"))?.label).toBe("3 weeks old today");
    // Day 63 is a weekly turn too, but by then months are the unit.
    expect(milestone("2026-04-07", at("2026-06-09T09:00:00"))).toBeNull();
  });

  it("marks monthly turns", () => {
    expect(milestone("2026-04-07", at("2026-08-07T09:00:00"))?.label).toBe("4 months old today");
    expect(milestone("2026-04-07", at("2026-08-08T09:00:00"))).toBeNull();
  });

  it("prefers the birthday over the monthly turn", () => {
    expect(milestone("2025-04-07", at("2026-04-07T09:00:00"))).toEqual({
      label: "1 year old today",
      emoji: "🎂",
    });
  });

  it("marks the hundredth day", () => {
    expect(milestone("2026-04-07", at("2026-07-16T09:00:00"))?.label).toBe("100 days old today");
  });

  it("says nothing on an ordinary day", () => {
    expect(milestone("2026-04-07", at("2026-08-19T09:00:00"))).toBeNull();
  });
});

describe("boopMessage", () => {
  it("cycles without ever running out", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const line = boopMessage("Otto", i, at("2026-04-07T10:00:00"));
      expect(line).toBeTruthy();
      seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps its voice down in the small hours", () => {
    const night = Array.from({ length: 5 }, (_, i) =>
      boopMessage("Otto", i, at("2026-04-07T03:00:00")),
    );
    expect(night).toContain("Otto says go back to sleep.");
  });

  it("works exactly as before when there is no AI pool yet", () => {
    const withoutExtra = boopMessage("Otto", 2, at("2026-04-07T10:00:00"));
    const withEmptyExtra = boopMessage("Otto", 2, at("2026-04-07T10:00:00"), { day: [], night: [] });
    expect(withEmptyExtra).toBe(withoutExtra);
  });

  it("mixes the AI-written pool in behind the built-in lines, by mood", () => {
    const extra = { day: ["Freshly written."], night: ["Quiet new one."] };
    const day = Array.from({ length: 8 }, (_, i) => boopMessage("Otto", i, at("2026-04-07T10:00:00"), extra));
    expect(day).toContain("Freshly written.");

    const night = Array.from({ length: 7 }, (_, i) => boopMessage("Otto", i, at("2026-04-07T03:00:00"), extra));
    expect(night).toContain("Quiet new one.");
    expect(night).not.toContain("Freshly written.");
  });
});

describe("childPhotoUrl", () => {
  const child = {
    id: 4,
    first_name: "Otto",
    last_name: "F",
    birth_date: "2026-04-07",
    picture_url: null,
    picture_content_type: "image/jpeg",
    created_at: "2026-04-07T00:00:00Z",
    updated_at: "2026-08-19T12:00:00Z",
  } as Child;

  it("cache-busts on updated_at so a new upload wins", () => {
    expect(childPhotoUrl(child, "/api")).toBe(
      "/api/children/4/photo?v=2026-08-19T12%3A00%3A00Z",
    );
  });

  it("is null when the child has no photo", () => {
    expect(childPhotoUrl({ ...child, picture_content_type: null }, "/api")).toBeNull();
  });
});
