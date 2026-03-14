import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  lastNDays,
  toDateKey,
  FeedingChart,
  DiaperChart,
  SleepChart,
  TummyTimeChart,
  PumpingChart,
  GrowthChart,
} from "../src/components/Charts";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  TummyTime,
  Pumping,
  Growth,
} from "../src/types/models";

// Mock recharts to avoid jsdom SVG measurement issues
vi.mock("recharts", () => {
  const MockContainer = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  );
  const MockChart = ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => (
    <div data-testid="chart" data-chart-data={JSON.stringify(data)}>{children}</div>
  );
  const MockElement = ({ dataKey }: { dataKey?: string }) => (
    <div data-testid={`chart-element-${dataKey || "unknown"}`} />
  );
  return {
    ResponsiveContainer: MockContainer,
    BarChart: MockChart,
    LineChart: MockChart,
    Bar: MockElement,
    Line: MockElement,
    XAxis: MockElement,
    YAxis: MockElement,
    CartesianGrid: () => <div />,
    Tooltip: () => <div />,
    Legend: () => <div />,
  };
});

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

// Helper: get today's local YYYY-MM-DD
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Helper: get a date N days ago as local YYYY-MM-DD
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Helper: construct an ISO timestamp for a given local date + hour
function isoAt(dateStr: string, hour: number): string {
  return `${dateStr}T${String(hour).padStart(2, "0")}:00:00`;
}

const baseRecord = { id: 1, child_id: 1, created_at: "", updated_at: "", notes: null };

// ── Helper function tests ──────────────────────────────────

describe("lastNDays", () => {
  it("returns the correct number of days", () => {
    expect(lastNDays(7)).toHaveLength(7);
    expect(lastNDays(14)).toHaveLength(14);
    expect(lastNDays(1)).toHaveLength(1);
  });

  it("ends with today", () => {
    const days = lastNDays(7);
    expect(days[days.length - 1]).toBe(todayStr());
  });

  it("starts N-1 days ago", () => {
    const days = lastNDays(7);
    expect(days[0]).toBe(daysAgoStr(6));
  });

  it("has consecutive dates in ascending order", () => {
    const days = lastNDays(5);
    for (let i = 1; i < days.length; i++) {
      expect(new Date(days[i]).getTime()).toBeGreaterThan(new Date(days[i - 1]).getTime());
    }
  });
});

describe("toDateKey", () => {
  it("converts an ISO timestamp to a local date string", () => {
    // Create a timestamp for today at noon local time
    const today = todayStr();
    const key = toDateKey(isoAt(today, 12));
    expect(key).toBe(today);
  });

  it("handles midnight correctly", () => {
    const today = todayStr();
    const key = toDateKey(isoAt(today, 0));
    expect(key).toBe(today);
  });
});

// ── FeedingChart ──────────────────────────────────────────────

describe("FeedingChart", () => {
  const today = todayStr();
  const yesterday = daysAgoStr(1);

  const makeFeeding = (type: Feeding["type"], dateStr: string, hour: number): Feeding => ({
    ...baseRecord,
    type,
    start_time: isoAt(dateStr, hour),
    end_time: isoAt(dateStr, hour + 1),
    amount: null,
    amount_unit: null,
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<FeedingChart feedings={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("renders with feeding data", () => {
    const feedings = [
      makeFeeding("bottle", today, 8),
      makeFeeding("breast_left", today, 10),
      makeFeeding("solid", today, 12),
    ];
    const { container } = render(<FeedingChart feedings={feedings} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("aggregates feedings by type correctly", () => {
    const feedings = [
      makeFeeding("bottle", today, 7),
      makeFeeding("bottle", today, 10),
      makeFeeding("breast_left", today, 8),
      makeFeeding("breast_right", today, 12),
      makeFeeding("solid", today, 14),
      makeFeeding("fortified_breast_milk", today, 16),
      makeFeeding("bottle", yesterday, 9),
    ];
    const { container } = render(<FeedingChart feedings={feedings} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);

    const todayData = data[data.length - 1];
    // 2 bottle + 1 fortified = 3 Bottle
    expect(todayData.Bottle).toBe(3);
    // 2 breast (left + right)
    expect(todayData.Breast).toBe(2);
    // 1 solid
    expect(todayData.Solid).toBe(1);

    const yesterdayData = data[data.length - 2];
    expect(yesterdayData.Bottle).toBe(1);
    expect(yesterdayData.Breast).toBe(0);
    expect(yesterdayData.Solid).toBe(0);
  });

  it("ignores data outside the date range", () => {
    const oldFeeding = makeFeeding("bottle", daysAgoStr(30), 8);
    const { container } = render(<FeedingChart feedings={[oldFeeding]} days={7} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const total = data.reduce((sum: number, d: { Bottle: number }) => sum + d.Bottle, 0);
    expect(total).toBe(0);
  });
});

// ── DiaperChart ──────────────────────────────────────────────

describe("DiaperChart", () => {
  const today = todayStr();

  const makeDiaper = (type: DiaperChange["type"], dateStr: string, hour: number): DiaperChange => ({
    ...baseRecord,
    time: isoAt(dateStr, hour),
    type,
    color: null,
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<DiaperChart diapers={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("aggregates diapers by type correctly", () => {
    const diapers = [
      makeDiaper("wet", today, 6),
      makeDiaper("wet", today, 9),
      makeDiaper("solid", today, 12),
      makeDiaper("both", today, 15),
      makeDiaper("both", today, 18),
    ];
    const { container } = render(<DiaperChart diapers={diapers} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Wet).toBe(2);
    expect(todayData.Solid).toBe(1);
    expect(todayData.Both).toBe(2);
  });
});

// ── SleepChart ───────────────────────────────────────────────

describe("SleepChart", () => {
  const today = todayStr();

  const makeSleep = (isNap: boolean, dateStr: string, startHour: number, endHour: number): SleepEntry => ({
    ...baseRecord,
    start_time: isoAt(dateStr, startHour),
    end_time: isoAt(dateStr, endHour),
    is_nap: isNap ? 1 : 0,
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<SleepChart sleeps={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("calculates sleep hours correctly", () => {
    const sleeps = [
      makeSleep(true, today, 9, 11),   // 2h nap
      makeSleep(true, today, 13, 14),  // 1h nap
      makeSleep(false, today, 20, 22), // 2h night (same day portion)
    ];
    const { container } = render(<SleepChart sleeps={sleeps} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Nap).toBe(3);
    expect(todayData.Night).toBe(2);
  });

  it("skips entries without end_time", () => {
    const sleeps: SleepEntry[] = [{
      ...baseRecord,
      start_time: isoAt(today, 9),
      end_time: null,
      is_nap: 1,
    }];
    const { container } = render(<SleepChart sleeps={sleeps} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Nap).toBe(0);
  });
});

// ── TummyTimeChart ─────────────────────────────────────────

describe("TummyTimeChart", () => {
  const today = todayStr();

  const makeTummy = (dateStr: string, startHour: number, durationMins: number): TummyTime => ({
    ...baseRecord,
    start_time: isoAt(dateStr, startHour),
    end_time: new Date(new Date(isoAt(dateStr, startHour)).getTime() + durationMins * 60000).toISOString(),
    milestone: null,
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<TummyTimeChart tummyTimes={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("sums minutes per day", () => {
    const tummyTimes = [
      makeTummy(today, 7, 15),   // 15 mins
      makeTummy(today, 11, 10),  // 10 mins
      makeTummy(today, 16, 20),  // 20 mins
    ];
    const { container } = render(<TummyTimeChart tummyTimes={tummyTimes} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Minutes).toBe(45);
  });

  it("skips entries without end_time", () => {
    const tummyTimes: TummyTime[] = [{
      ...baseRecord,
      start_time: isoAt(today, 9),
      end_time: null,
      milestone: null,
    }];
    const { container } = render(<TummyTimeChart tummyTimes={tummyTimes} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Minutes).toBe(0);
  });
});

// ── PumpingChart ─────────────────────────────────────────────

describe("PumpingChart", () => {
  const today = todayStr();

  const makePump = (dateStr: string, hour: number, amount: number | null): Pumping => ({
    ...baseRecord,
    start_time: isoAt(dateStr, hour),
    end_time: isoAt(dateStr, hour + 1),
    amount,
    amount_unit: amount ? "oz" : null,
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<PumpingChart pumpings={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("sums amounts per day", () => {
    const pumpings = [
      makePump(today, 7, 5),
      makePump(today, 13, 4),
      makePump(today, 21, 3),
    ];
    const { container } = render(<PumpingChart pumpings={pumpings} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Amount).toBe(12);
  });

  it("skips entries with null amount", () => {
    const pumpings = [makePump(today, 7, null)];
    const { container } = render(<PumpingChart pumpings={pumpings} days={3} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    const todayData = data[data.length - 1];
    expect(todayData.Amount).toBe(0);
  });
});

// ── GrowthChart ──────────────────────────────────────────────

describe("GrowthChart", () => {
  const makeGrowth = (
    date: string,
    weight: number | null,
    height: number | null,
    head: number | null
  ): Growth => ({
    ...baseRecord,
    date,
    weight,
    weight_unit: weight ? "lb" : null,
    height,
    height_unit: height ? "in" : null,
    head_circumference: head,
    head_circumference_unit: head ? "in" : null,
  });

  it("returns null when given empty data", () => {
    const { container } = render(<GrowthChart growths={[]} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeNull();
  });

  it("renders with growth data", () => {
    const growths = [
      makeGrowth("2024-06-15", 7.5, 19.5, 13.5),
      makeGrowth("2024-09-15", 14.0, 24.0, 16.0),
      makeGrowth("2024-12-15", 17.0, 26.0, 17.0),
    ];
    const { container } = render(<GrowthChart growths={growths} />, { wrapper: Wrapper });
    expect(container.querySelector("[data-testid='chart']")).toBeTruthy();
  });

  it("sorts data chronologically", () => {
    const growths = [
      makeGrowth("2024-12-15", 17.0, 26.0, 17.0),
      makeGrowth("2024-06-15", 7.5, 19.5, 13.5),
      makeGrowth("2024-09-15", 14.0, 24.0, 16.0),
    ];
    const { container } = render(<GrowthChart growths={growths} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    // Weight should be in ascending order (chronological)
    expect(data[0].Weight).toBe(7.5);
    expect(data[1].Weight).toBe(14.0);
    expect(data[2].Weight).toBe(17.0);
  });

  it("handles partial measurements", () => {
    const growths = [
      makeGrowth("2024-06-15", 7.5, null, null),
      makeGrowth("2024-09-15", null, 24.0, null),
    ];
    const { container } = render(<GrowthChart growths={growths} />, { wrapper: Wrapper });
    const chart = container.querySelector("[data-testid='chart']");
    const data = JSON.parse(chart!.getAttribute("data-chart-data")!);
    expect(data[0].Weight).toBe(7.5);
    expect(data[0].Height).toBeUndefined();
    expect(data[1].Weight).toBeUndefined();
    expect(data[1].Height).toBe(24.0);
  });
});
