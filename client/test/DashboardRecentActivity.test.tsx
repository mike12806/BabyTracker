import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
import type {
  Child,
  DiaperChange,
  Feeding,
  Medication,
  Note,
  Pumping,
  SleepEntry,
  Temperature,
  TummyTime,
} from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

import { useChildren } from "../src/hooks/useChildren";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>{children}</DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const child: Child = {
  id: 1,
  first_name: "Nolan",
  last_name: "Faherty",
  birth_date: "2025-06-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2025-06-01T12:00:00Z",
  updated_at: "2025-06-01T12:00:00Z",
};

// Anchored to local noon so every "hours ago" offset below lands on the same
// calendar day regardless of when the suite runs.
const noonToday = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
})();

function hoursAgo(hours: number): string {
  return new Date(noonToday.getTime() - hours * 3600_000).toISOString();
}

const feeding = (id: number, start: string, end: string): Feeding => ({
  id,
  child_id: 1,
  type: "bottle_formula",
  start_time: start,
  end_time: end,
  amount: 5,
  amount_unit: "cc",
  notes: null,
  created_at: start,
  updated_at: start,
});

const diaper = (id: number, time: string): DiaperChange => ({
  id,
  child_id: 1,
  time,
  type: "wet",
  color: null,
  notes: null,
  created_at: time,
  updated_at: time,
});

const sleep = (id: number, start: string, end: string): SleepEntry => ({
  id,
  child_id: 1,
  start_time: start,
  end_time: end,
  is_nap: 1,
  notes: null,
  created_at: start,
  updated_at: start,
});

const pumping = (id: number, start: string, end: string): Pumping => ({
  id,
  child_id: 1,
  start_time: start,
  end_time: end,
  side: "both",
  amount: 3,
  amount_unit: "oz",
  notes: null,
  created_at: start,
  updated_at: start,
});

const tummyTime = (id: number, start: string, end: string): TummyTime => ({
  id,
  child_id: 1,
  start_time: start,
  end_time: end,
  milestone: null,
  notes: null,
  created_at: start,
  updated_at: start,
});

const temperature = (id: number, time: string): Temperature => ({
  id,
  child_id: 1,
  time,
  reading: 98.6,
  reading_unit: "F",
  notes: null,
  created_at: time,
  updated_at: time,
});

const note = (id: number, time: string, title: string | null, content: string): Note => ({
  id,
  child_id: 1,
  time,
  title,
  content,
  created_at: time,
  updated_at: time,
});

const medication = (id: number, time: string): Medication => ({
  id,
  child_id: 1,
  time,
  name: "Tylenol",
  dosage: 2.5,
  dosage_unit: "ml",
  notes: null,
  created_at: time,
  updated_at: time,
});

/** Titles of the Recent activity rows, in the order they are rendered. */
function recentActivityTitles(): string[] {
  return screen
    .getAllByRole("button", { name: /^Edit .+ at / })
    .map((row) => row.getAttribute("aria-label")!.replace(/^Edit /, "").replace(/ at [^ ]+ [AP]?M?$/, ""));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseChildren.mockReturnValue({
    children: [child],
    selectedChild: child,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
  mockApi.get.mockResolvedValue([]);
});

describe("Dashboard – recent activity feed", () => {
  it("interleaves every activity type in reverse-chronological order", async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([feeding(1, hoursAgo(1), hoursAgo(0.75))]);
      if (url.includes("/diaper-changes")) return Promise.resolve([diaper(2, hoursAgo(0.5))]);
      if (url.includes("/sleep")) return Promise.resolve([sleep(3, hoursAgo(3), hoursAgo(2.5))]);
      if (url.includes("/pumping")) return Promise.resolve([pumping(4, hoursAgo(2), hoursAgo(1.75))]);
      if (url.includes("/tummy-time")) return Promise.resolve([tummyTime(5, hoursAgo(4), hoursAgo(3.75))]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await screen.findByText(/Diaper · Wet/);
    expect(recentActivityTitles()).toEqual([
      "Diaper · Wet",
      "Bottle Formula · 5 mL",
      "Pump · Both · 89 mL",
      "Nap",
      "Tummy time",
    ]);
  });

  it("includes temperatures, notes and medications", async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/temperature")) return Promise.resolve([temperature(6, hoursAgo(1))]);
      if (url.includes("/notes")) return Promise.resolve([note(7, hoursAgo(2), null, "Slept through the night")]);
      if (url.includes("/medications")) return Promise.resolve([medication(8, hoursAgo(3))]);
      if (url.includes("/feedings")) return Promise.resolve([feeding(1, hoursAgo(0.5), hoursAgo(0.25))]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await screen.findByText(/Temp · 98.6°F/);
    expect(recentActivityTitles()).toEqual([
      "Bottle Formula · 5 mL",
      "Temp · 98.6°F",
      "Note · Slept through the night",
      "Tylenol · 2.5 ml",
    ]);
  });

  it("titles a note by its title and keeps the body as the subtitle", async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/notes")) return Promise.resolve([note(7, hoursAgo(1), "Rash", "Small red patch on left arm")]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    expect(await screen.findByText("Note · Rash")).toBeTruthy();
    expect(screen.getByText("Small red patch on left arm")).toBeTruthy();
  });

  it("excludes to-dos, which have their own section", async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/todos")) {
        return Promise.resolve([
          {
            id: 9,
            child_id: 1,
            title: "Book 6 month checkup",
            notes: null,
            due_date: null,
            priority: "high",
            completed: 0,
            completed_at: null,
            created_at: hoursAgo(1),
            updated_at: hoursAgo(1),
          },
        ]);
      }
      if (url.includes("/feedings")) return Promise.resolve([feeding(1, hoursAgo(2), hoursAgo(1.75))]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await screen.findByText("Bottle Formula · 5 mL");
    expect(recentActivityTitles()).toEqual(["Bottle Formula · 5 mL"]);
  });

  it("does not let a run of feedings crowd out other activity", async () => {
    // The feed shows six rows; ten feedings alone would fill it if the entries
    // were not merged by timestamp.
    const feedings = Array.from({ length: 10 }, (_, i) =>
      feeding(100 + i, hoursAgo(i + 1), hoursAgo(i + 0.75)),
    );
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve(feedings);
      if (url.includes("/diaper-changes")) return Promise.resolve([diaper(2, hoursAgo(0.25))]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await screen.findByText(/Diaper · Wet/);
    expect(recentActivityTitles()[0]).toBe("Diaper · Wet");
    expect(recentActivityTitles()).toHaveLength(6);
  });

  it("ranks by date, not by time of day, and marks entries from earlier days", async () => {
    // Regression: sorting on the formatted clock time put last night's 11:30 PM
    // feeding above this morning's diaper — or, in browsers that reject the
    // string, left the feed in per-category order so only feedings showed.
    const lastNight = new Date(noonToday);
    lastNight.setDate(lastNight.getDate() - 1);
    lastNight.setHours(23, 30, 0, 0);

    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([feeding(1, lastNight.toISOString(), lastNight.toISOString())]);
      if (url.includes("/diaper-changes")) return Promise.resolve([diaper(2, hoursAgo(4))]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await screen.findByText(/Diaper · Wet/);
    expect(recentActivityTitles()).toEqual(["Diaper · Wet", "Bottle Formula · 5 mL"]);
    // Scoped to the row: past 11:30 PM the Feeding tile's own relative time
    // also reads "Yesterday", and an unscoped query then matches both.
    const feedingRow = screen.getByRole("button", { name: /^Edit Bottle Formula/ });
    expect(within(feedingRow).getByText(/Yesterday/)).toBeTruthy();
  });
});
