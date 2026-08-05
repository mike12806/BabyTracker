import { describe, it, expect } from "vitest";
import { formatWeight, lbOzToPounds, poundsToLbOz } from "../src/utils/weight";

describe("lbOzToPounds", () => {
  it("combines pounds and ounces", () => {
    expect(lbOzToPounds("7", "4")).toBe(7.25);
    expect(lbOzToPounds("10", "15")).toBe(10.9375);
  });

  it("treats a missing side as zero", () => {
    expect(lbOzToPounds("8", "")).toBe(8);
    expect(lbOzToPounds("", "12")).toBe(0.75);
  });

  it("returns null when both fields are blank", () => {
    expect(lbOzToPounds("", "")).toBeNull();
    expect(lbOzToPounds("  ", " ")).toBeNull();
  });

  it("ignores unparseable input", () => {
    expect(lbOzToPounds("abc", "4")).toBe(0.25);
    expect(lbOzToPounds("abc", "xyz")).toBeNull();
  });

  it("accepts fractional ounces", () => {
    expect(lbOzToPounds("7", "4.5")).toBe(7.2813);
  });
});

describe("poundsToLbOz", () => {
  it("splits decimal pounds", () => {
    expect(poundsToLbOz(7.25)).toEqual({ lb: 7, oz: 4 });
    expect(poundsToLbOz(10.9375)).toEqual({ lb: 10, oz: 15 });
    expect(poundsToLbOz(8)).toEqual({ lb: 8, oz: 0 });
  });

  it("keeps half ounces", () => {
    expect(poundsToLbOz(7.2813)).toEqual({ lb: 7, oz: 4.5 });
  });

  it("carries a rounded 16 oz into the next pound", () => {
    expect(poundsToLbOz(7.9999)).toEqual({ lb: 8, oz: 0 });
  });

  it("round-trips through lbOzToPounds", () => {
    for (const value of [0.25, 6, 7.25, 12.5625, 21.9375]) {
      const { lb, oz } = poundsToLbOz(value);
      expect(lbOzToPounds(String(lb), String(oz))).toBe(value);
    }
  });
});

describe("formatWeight", () => {
  it("formats pounds as lb + oz", () => {
    expect(formatWeight(7.25, "lb")).toBe("7 lb 4 oz");
    expect(formatWeight(8, "lb")).toBe("8 lb");
    expect(formatWeight(0.75, "lb")).toBe("12 oz");
  });

  it("leaves other units alone", () => {
    expect(formatWeight(3.4, "kg")).toBe("3.4 kg");
    expect(formatWeight(120, "oz")).toBe("120 oz");
    expect(formatWeight(3400, null)).toBe("3400");
  });

  it("returns an empty string when there is no value", () => {
    expect(formatWeight(null, "lb")).toBe("");
    expect(formatWeight(undefined, "lb")).toBe("");
  });
});
