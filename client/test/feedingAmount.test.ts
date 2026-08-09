import { describe, it, expect } from "vitest";
import {
  amountTotals,
  asVolumeUnit,
  convertVolume,
  displayAmount,
  formatAmountTotal,
  formatEntryAmount,
  isVolumeUnit,
  pumpingLogUnit,
  roundForUnit,
  unitLabel,
  volumeTotal,
  type AmountEntry,
} from "../src/utils/feedingAmount";

function entry(amount: number | null, amount_unit: string | null): AmountEntry {
  return { amount, amount_unit };
}

describe("amountTotals", () => {
  it("returns nothing when no entry has an amount", () => {
    expect(amountTotals([], "ml")).toEqual([]);
    expect(amountTotals([entry(null, null), entry(null, "oz")], "ml")).toEqual([]);
  });

  it("totals in the display unit, not the recorded one", () => {
    expect(amountTotals([entry(30, "cc"), entry(20, "cc"), entry(30, "cc")], "ml")).toEqual([
      { value: 80, unit: "ml" },
    ]);
    // 7.5 oz = 221.8 mL
    expect(amountTotals([entry(4, "oz"), entry(3.5, "oz")], "ml")).toEqual([
      { value: 222, unit: "ml" },
    ]);
  });

  it("converts a day that mixes units into the one on display", () => {
    // 4 oz = 118.294 mL, + 30 mL + 20 cc = 168.294 -> 168
    expect(amountTotals([entry(4, "oz"), entry(30, "ml"), entry(20, "cc")], "ml")).toEqual([
      { value: 168, unit: "ml" },
    ]);
    // The same day read in ounces: 168.294 / 29.5735 = 5.69 -> 5.7
    expect(amountTotals([entry(4, "oz"), entry(30, "ml"), entry(20, "cc")], "oz")).toEqual([
      { value: 5.7, unit: "oz" },
    ]);
  });

  it("treats cc and ml as the same size", () => {
    expect(amountTotals([entry(30, "cc"), entry(20, "ml")], "cc")).toEqual([
      { value: 50, unit: "cc" },
    ]);
  });

  it("reports grams separately from the volume, since they cannot be converted", () => {
    expect(amountTotals([entry(60, "cc"), entry(100, "g"), entry(4, "oz")], "ml")).toEqual([
      { value: 178, unit: "ml" },
      { value: 100, unit: "g" },
    ]);
  });

  it("returns only a gram total when nothing was measured by volume", () => {
    expect(amountTotals([entry(80, "g"), entry(45, "g")], "ml")).toEqual([
      { value: 125, unit: "g" },
    ]);
  });

  it("reads an amount saved without a unit as already being on display", () => {
    expect(amountTotals([entry(30, "cc"), entry(20, "cc"), entry(25, null)], "ml")).toEqual([
      { value: 75, unit: "ml" },
    ]);
    expect(amountTotals([entry(30, null), entry(20, null)], "oz")).toEqual([
      { value: 50, unit: "oz" },
    ]);
  });

  it("rounds away floating point noise", () => {
    expect(amountTotals([entry(0.1, "oz"), entry(0.2, "oz")], "oz")).toEqual([
      { value: 0.3, unit: "oz" },
    ]);
  });
});

describe("volumeTotal", () => {
  it("gives the volume alone, in the display unit", () => {
    expect(volumeTotal([entry(45, "cc"), entry(1.5, "oz")], "ml")).toBe(89);
  });

  it("skips a mass rather than folding it into a volume", () => {
    expect(volumeTotal([entry(45, "cc"), entry(100, "g")], "ml")).toBe(45);
    expect(volumeTotal([entry(100, "g")], "ml")).toBeNull();
  });

  it("is null when nothing was measured", () => {
    expect(volumeTotal([], "ml")).toBeNull();
  });
});

describe("displayAmount / formatEntryAmount", () => {
  it("restates a single entry in the display unit", () => {
    expect(displayAmount(entry(1.5, "oz"), "ml")).toEqual({ value: 44, unit: "ml" });
    expect(displayAmount(entry(55, "cc"), "ml")).toEqual({ value: 55, unit: "ml" });
    expect(displayAmount(entry(59.147, "ml"), "oz")).toEqual({ value: 2, unit: "oz" });
  });

  it("leaves a mass as it was logged", () => {
    expect(displayAmount(entry(100, "g"), "ml")).toEqual({ value: 100, unit: "g" });
  });

  it("reads an amount with no unit as already being on display", () => {
    expect(displayAmount(entry(45, null), "cc")).toEqual({ value: 45, unit: "cc" });
  });

  it("is null when the entry has no amount", () => {
    expect(displayAmount(entry(null, "oz"), "ml")).toBeNull();
    expect(formatEntryAmount(entry(null, "oz"), "ml")).toBeNull();
  });

  it("prints the converted amount", () => {
    expect(formatEntryAmount(entry(1.5, "oz"), "ml")).toBe("44 mL");
    expect(formatEntryAmount(entry(55, "cc"), "oz")).toBe("1.9 oz");
    expect(formatEntryAmount(entry(100, "g"), "ml")).toBe("100 g");
  });
});

describe("roundForUnit", () => {
  it("counts millilitres and cc whole", () => {
    expect(roundForUnit(44.36, "ml")).toBe(44);
    expect(roundForUnit(44.36, "cc")).toBe(44);
  });

  it("keeps tenths of an ounce", () => {
    expect(roundForUnit(1.4802, "oz")).toBe(1.5);
  });
});

describe("formatAmountTotal", () => {
  it("capitalizes the L in millilitres", () => {
    expect(formatAmountTotal({ value: 168, unit: "ml" })).toBe("168 mL");
  });

  it("leaves other units as recorded", () => {
    expect(formatAmountTotal({ value: 80, unit: "cc" })).toBe("80 cc");
    expect(formatAmountTotal({ value: 7.5, unit: "oz" })).toBe("7.5 oz");
    expect(formatAmountTotal({ value: 100, unit: "g" })).toBe("100 g");
  });
});

describe("unitLabel", () => {
  it("capitalizes only the L in millilitres", () => {
    expect(unitLabel("ml")).toBe("mL");
    expect(unitLabel("cc")).toBe("cc");
    expect(unitLabel("oz")).toBe("oz");
    expect(unitLabel("g")).toBe("g");
  });
});

describe("isVolumeUnit", () => {
  it("accepts the volume units", () => {
    expect(isVolumeUnit("ml")).toBe(true);
    expect(isVolumeUnit("cc")).toBe(true);
    expect(isVolumeUnit("oz")).toBe(true);
  });

  it("rejects grams and missing units", () => {
    expect(isVolumeUnit("g")).toBe(false);
    expect(isVolumeUnit(null)).toBe(false);
    expect(isVolumeUnit(undefined)).toBe(false);
  });
});

describe("asVolumeUnit", () => {
  it("passes through a volume unit and falls back to millilitres otherwise", () => {
    expect(asVolumeUnit("oz")).toBe("oz");
    expect(asVolumeUnit("g")).toBe("ml");
    expect(asVolumeUnit(null)).toBe("ml");
    expect(asVolumeUnit("nonsense")).toBe("ml");
  });
});

describe("pumpingLogUnit", () => {
  it("logs cc as millilitres, which pumping accepts and is the same volume", () => {
    expect(pumpingLogUnit("cc")).toBe("ml");
    expect(pumpingLogUnit("ml")).toBe("ml");
    expect(pumpingLogUnit("oz")).toBe("oz");
  });
});

describe("convertVolume", () => {
  it("converts between volume units", () => {
    expect(convertVolume(4, "oz", "ml")).toBeCloseTo(118.294, 3);
    expect(convertVolume(30, "cc", "ml")).toBe(30);
    expect(convertVolume(29.5735, "ml", "oz")).toBeCloseTo(1, 6);
  });

  it("is a no-op between the same unit", () => {
    expect(convertVolume(30, "cc", "cc")).toBe(30);
  });

  it("refuses anything that is not a volume", () => {
    expect(convertVolume(100, "g", "ml")).toBeNull();
    expect(convertVolume(100, "ml", "g")).toBeNull();
  });
});
