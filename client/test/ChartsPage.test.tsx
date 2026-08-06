import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ChartsPage from "../src/pages/ChartsPage";
import type { Child, Feeding } from "../src/types/models";

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
  const MockContainer = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const MockChart = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
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

const baseChild: Child = {
  id: 1,
  first_name: "Nolan",
  last_name: "Faherty",
  birth_date: "2025-08-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2025-08-01T12:00:00Z",
  updated_at: "2025-08-01T12:00:00Z",
};

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

function feeding(overrides: Partial<Feeding> & { id: number }): Feeding {
  return {
    child_id: 1,
    type: "bottle_formula",
    start_time: hoursAgo(2),
    end_time: null,
    amount: null,
    amount_unit: null,
    notes: null,
    created_at: hoursAgo(2),
    updated_at: hoursAgo(2),
    ...overrides,
  };
}

async function feedingCard(): Promise<HTMLElement> {
  const title = await screen.findByText("Feeding");
  const card = title.closest(".MuiCard-root");
  if (!card) throw new Error("Feeding card not found");
  return card as HTMLElement;
}

function mockFeedings(feedings: Feeding[]) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes("/feedings")) return Promise.resolve(feedings);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseChildren.mockReturnValue({
    children: [baseChild],
    selectedChild: baseChild,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
  mockApi.get.mockResolvedValue([]);
});

describe("ChartsPage – Feeding summary", () => {
  it("shows the average amount fed per day with its unit", async () => {
    // 7 day range: 70 + 35 cc over 7 days = 15.0 cc/day
    mockFeedings([
      feeding({ id: 1, amount: 70, amount_unit: "cc", start_time: hoursAgo(2) }),
      feeding({ id: 2, amount: 35, amount_unit: "cc", start_time: hoursAgo(30) }),
    ]);

    render(<ChartsPage />, { wrapper: Wrapper });

    const card = within(await feedingCard());
    expect(card.getByText("15.0")).toBeTruthy();
    expect(card.getByText("cc/day")).toBeTruthy();
  });

  it("ignores feedings recorded in a different unit than the dominant one", async () => {
    // oz is the dominant unit (2 entries); the 100 g solid is excluded.
    mockFeedings([
      feeding({ id: 1, amount: 4, amount_unit: "oz", start_time: hoursAgo(2) }),
      feeding({ id: 2, amount: 3, amount_unit: "oz", start_time: hoursAgo(26) }),
      feeding({ id: 3, type: "solid", amount: 100, amount_unit: "g", start_time: hoursAgo(3) }),
    ]);

    render(<ChartsPage />, { wrapper: Wrapper });

    const card = within(await feedingCard());
    expect(card.getByText("1.0")).toBeTruthy();
    expect(card.getByText("oz/day")).toBeTruthy();
  });

  it("excludes feedings outside the selected range", async () => {
    mockFeedings([
      feeding({ id: 1, amount: 70, amount_unit: "ml", start_time: hoursAgo(2) }),
      feeding({ id: 2, amount: 999, amount_unit: "ml", start_time: hoursAgo(24 * 20) }),
    ]);

    render(<ChartsPage />, { wrapper: Wrapper });

    const card = within(await feedingCard());
    expect(card.getByText("10.0")).toBeTruthy();
    expect(card.getByText("ml/day")).toBeTruthy();
  });

  it("falls back to feedings per day when no amounts are recorded", async () => {
    mockFeedings([
      feeding({ id: 1, start_time: hoursAgo(2) }),
      feeding({ id: 2, start_time: hoursAgo(5) }),
      feeding({ id: 3, start_time: hoursAgo(26) }),
      feeding({ id: 4, start_time: hoursAgo(30) }),
      feeding({ id: 5, start_time: hoursAgo(50) }),
      feeding({ id: 6, start_time: hoursAgo(52) }),
      feeding({ id: 7, start_time: hoursAgo(70) }),
    ]);

    render(<ChartsPage />, { wrapper: Wrapper });

    const card = within(await feedingCard());
    expect(card.getByText("1.0")).toBeTruthy();
    expect(card.getByText("/day")).toBeTruthy();
  });
});
