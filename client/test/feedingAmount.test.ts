import { describe, it, expect } from "vitest";
import { amountTotals, formatAmountTotal, type AmountEntry } from "../src/utils/feedingAmount";

function entry(amount: number | null, amount_unit: string | null): AmountEntry {
  return { amount, amount_unit };
}

describe("amountTotals", () => {
  it("returns nothing when no entry has an amount", () => {
    expect(amountTotals([])).toEqual([]);
    expect(amountTotals([entry(null, null), entry(null, "oz")])).toEqual([]);
  });

  it("keeps the recorded unit when every entry shares one", () => {
    expect(amountTotals([entry(30, "cc"), entry(20, "cc"), entry(30, "cc")])).toEqual([
      { value: 80, unit: "cc" },
    ]);
    expect(amountTotals([entry(4, "oz"), entry(3.5, "oz")])).toEqual([{ value: 7.5, unit: "oz" }]);
  });

  it("normalizes to millilitres when the units differ", () => {
    // 4 oz = 118.294 mL, + 30 mL + 20 cc = 168.294 -> 168
    expect(amountTotals([entry(4, "oz"), entry(30, "ml"), entry(20, "cc")])).toEqual([
      { value: 168, unit: "ml" },
    ]);
  });

  it("normalizes ml and cc together even though they are the same size", () => {
    expect(amountTotals([entry(30, "cc"), entry(20, "ml")])).toEqual([{ value: 50, unit: "ml" }]);
  });

  it("reports grams separately from the volume, since they cannot be converted", () => {
    expect(amountTotals([entry(60, "cc"), entry(100, "g"), entry(4, "oz")])).toEqual([
      { value: 178, unit: "ml" },
      { value: 100, unit: "g" },
    ]);
  });

  it("returns only a gram total when nothing was measured by volume", () => {
    expect(amountTotals([entry(80, "g"), entry(45, "g")])).toEqual([{ value: 125, unit: "g" }]);
  });

  it("counts unit-less amounts against the dominant unit", () => {
    // The two cc entries make cc dominant, so the bare 25 is treated as cc.
    expect(amountTotals([entry(30, "cc"), entry(20, "cc"), entry(25, null)])).toEqual([
      { value: 75, unit: "cc" },
    ]);
  });

  it("totals unit-less amounts on their own when no unit was ever recorded", () => {
    expect(amountTotals([entry(30, null), entry(20, null)])).toEqual([{ value: 50, unit: null }]);
  });

  it("rounds away floating point noise", () => {
    expect(amountTotals([entry(0.1, "oz"), entry(0.2, "oz")])).toEqual([{ value: 0.3, unit: "oz" }]);
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

  it("prints a bare number when there is no unit", () => {
    expect(formatAmountTotal({ value: 50, unit: null })).toBe("50");
  });
});
