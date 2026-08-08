import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
import FeedingsPage from "../src/pages/FeedingsPage";
import PumpingPage from "../src/pages/PumpingPage";
import type { Child, Feeding, Pumping } from "../src/types/models";

vi.mock("../src/api/client", () => ({
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

  it("keeps the recorded unit on the feedings page when the day uses only one", async () => {
    mockData([feeding(1, 45, "cc"), feeding(2, 55, "cc")]);

    render(<FeedingsPage />, { wrapper: Wrapper });

    expect(await statCardValue("Volume")).toBe("100 cc");
  });

  it("carries a gram total alongside the volume rather than dropping it", async () => {
    mockData([feeding(1, 45, "cc"), { ...feeding(2, 100, "g"), type: "solid" }]);

    render(<FeedingsPage />, { wrapper: Wrapper });

    const card = await statCard("Volume");
    expect(await statCardValue("Volume")).toBe("45 cc");
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
