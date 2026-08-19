import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
import FeedingsPage from "../src/pages/FeedingsPage";
import PumpingPage from "../src/pages/PumpingPage";
import type { Child, Feeding, Pumping } from "../src/types/models";
import type { VolumeUnit } from "../src/utils/feedingAmount";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })),
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

// Mock recharts to avoid jsdom SVG issues
vi.mock("recharts", () => {
  const MockContainer = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const MockChart = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const MockElement = () => <div />;
  return {
    ResponsiveContainer: MockContainer,
    BarChart: MockChart,
    ComposedChart: MockChart,
    LineChart: MockChart,
    Bar: MockElement,
    Line: MockElement,
    XAxis: MockElement,
    YAxis: MockElement,
    CartesianGrid: MockElement,
    Tooltip: MockElement,
    Legend: MockElement,
  };
});

import { useChildren } from "../src/hooks/useChildren";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { VolumeUnitProvider } from "../src/hooks/useVolumeUnit";
import { resetUserSettingsCache } from "../src/api/userSettings";
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <VolumeUnitProvider>{children}</VolumeUnitProvider>
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** Serve the settings row that decides which unit everything is shown in. */
function displayUnit(unit: VolumeUnit) {
  localStorage.setItem("volume-unit", unit);
}

const child: Child = {
  id: 1,
  first_name: "Nolan",
  last_name: "Faherty",
  birth_date: "2025-08-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2025-08-01T12:00:00Z",
  updated_at: "2025-08-01T12:00:00Z",
};

/**
 * Minutes past local midnight, so every entry lands on today whichever hour
 * the suite runs at — both screens decide "today" from the local date.
 */
function todayAt(minutes: number): string {
  const d = new Date();
  d.setHours(0, minutes, 0, 0);
  return d.toISOString();
}

function feeding(id: number, amount: number, amount_unit: Feeding["amount_unit"]): Feeding {
  return {
    id,
    child_id: 1,
    type: "bottle_formula",
    start_time: todayAt(id),
    end_time: null,
    amount,
    amount_unit,
    notes: null,
    created_at: todayAt(id),
    updated_at: todayAt(id),
  };
}

function pumping(id: number, amount: number, amount_unit: Pumping["amount_unit"]): Pumping {
  return {
    id,
    child_id: 1,
    start_time: todayAt(id),
    end_time: null,
    side: "both",
    amount,
    amount_unit,
    notes: null,
    created_at: todayAt(id),
    updated_at: todayAt(id),
  };
}

// A day logged the way the app allows: mostly cc, with one bottle in ounces.
// 226 cc + 1.5 oz (44.36 mL) = 270.36 -> 270 mL.
const mixedFeedings: Feeding[] = [
  feeding(1, 45, "cc"),
  feeding(2, 1.5, "oz"),
  feeding(3, 45, "cc"),
  feeding(4, 45, "cc"),
  feeding(5, 55, "cc"),
  feeding(6, 36, "cc"),
];

function mockData(feedings: Feeding[], pumpings: Pumping[] = []) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.startsWith("/feedings")) return Promise.resolve(feedings);
    if (url.startsWith("/pumping")) return Promise.resolve(pumpings);
    return Promise.resolve([]);
  });
}

/** The headline value of the dashboard's "today so far" tile with this label. */
async function dashboardStat(label: string): Promise<string> {
  const labelEl = await screen.findByText(label);
  // The label sits beside its colour dot, one level inside the tile.
  const tile = labelEl.parentElement?.parentElement;
  return tile?.children[1]?.textContent ?? "";
}

/** The headline value of a log page's StatCard with this label. */
async function statCard(label: string): Promise<HTMLElement> {
  const labelEl = await screen.findByText(label);
  const card = labelEl.parentElement;
  if (!card) throw new Error(`No card around "${label}"`);
  return card as HTMLElement;
}

async function statCardValue(label: string): Promise<string> {
  return (await statCard(label)).children[1]?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetUserSettingsCache();
  mockUseChildren.mockReturnValue({
    children: [child],
    selectedChild: child,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useChildren>);
  mockApi.get.mockResolvedValue([]);
});

describe("today's volume total", () => {
  it("matches between the dashboard and the feedings page when units are mixed", async () => {
    mockData(mixedFeedings);
    const { unmount } = render(<Dashboard />, { wrapper: Wrapper });
    const dashboardTotal = await dashboardStat("fed");
    unmount();

    mockData(mixedFeedings);
    render(<FeedingsPage />, { wrapper: Wrapper });
    const feedingsTotal = await statCardValue("Volume");

    expect(dashboardTotal).toBe("270 mL");
    expect(feedingsTotal).toBe(dashboardTotal);
  });

  it("shows the total and every row it came from in the one display unit", async () => {
    mockData(mixedFeedings);

    render(<FeedingsPage />, { wrapper: Wrapper });

    // The day was logged mostly in cc with one bottle in ounces; nothing on
    // screen says cc or oz.
    expect(await statCardValue("Volume")).toBe("270 mL");
    expect(screen.getAllByText("45 mL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("44 mL").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bcc\b/)).toBeNull();
    expect(screen.queryByText(/\boz\b/)).toBeNull();
  });

  it("restates the same day in ounces when that is the chosen unit", async () => {
    displayUnit("oz");
    mockData(mixedFeedings);

    render(<FeedingsPage />, { wrapper: Wrapper });

    // 270.36 mL / 29.5735 = 9.14 -> 9.1 oz, and the 45 cc bottles read as 1.5.
    expect(await statCardValue("Volume")).toBe("9.1 oz");
    expect(screen.getAllByText("1.5 oz").length).toBeGreaterThan(0);
  });

  it("carries a gram total alongside the volume rather than dropping it", async () => {
    mockData([feeding(1, 45, "cc"), { ...feeding(2, 100, "g"), type: "solid" }]);

    render(<FeedingsPage />, { wrapper: Wrapper });

    const card = await statCard("Volume");
    expect(await statCardValue("Volume")).toBe("45 mL");
    expect(within(card).getByText("+ 100 g today")).toBeTruthy();
  });

  it("matches between the dashboard and the pumping page when units are mixed", async () => {
    // 4 oz = 118.294 mL + 30 mL = 148.294 -> 148 mL
    const pumpings = [pumping(1, 4, "oz"), pumping(2, 30, "ml")];

    mockData([], pumpings);
    const { unmount } = render(<Dashboard />, { wrapper: Wrapper });
    const dashboardTotal = await dashboardStat("pumped");
    unmount();

    mockData([], pumpings);
    render(<PumpingPage />, { wrapper: Wrapper });
    const pumpingTotal = await statCardValue("Volume");

    expect(dashboardTotal).toBe("148 mL");
    expect(pumpingTotal).toBe(dashboardTotal);
  });
});
