import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
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
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

const baseChild: Child = {
  id: 1,
  first_name: "Mikey",
  last_name: "Faherty",
  birth_date: "2023-08-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2023-08-01T12:00:00Z",
  updated_at: "2023-08-01T12:00:00Z",
};

const baseFeeding: Feeding = {
  id: 1,
  child_id: 1,
  type: "bottle",
  start_time: "2024-12-01T08:00:00Z",
  end_time: "2024-12-01T08:18:00Z",
  amount: null,
  amount_unit: null,
  notes: null,
  created_at: "2024-12-01T08:20:00Z",
  updated_at: "2024-12-01T08:20:00Z",
};

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

describe("Dashboard – Recent Feedings amount display", () => {
  it("shows only duration when feeding has no amount", async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([baseFeeding]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    const duration = await screen.findByText(/18m/);
    expect(duration).toBeTruthy();
    // amount should not appear
    expect(screen.queryByText(/oz/)).toBeNull();
    expect(screen.queryByText(/ml/)).toBeNull();
  });

  it("shows amount and unit alongside duration when feeding has an amount", async () => {
    const feedingWithAmount: Feeding = {
      ...baseFeeding,
      amount: 4,
      amount_unit: "oz",
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([feedingWithAmount]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    const amountDuration = await screen.findByText(/4 oz · 18m/);
    expect(amountDuration).toBeTruthy();
  });

  it("shows amount in ml alongside duration", async () => {
    const feedingWithMl: Feeding = {
      ...baseFeeding,
      amount: 120,
      amount_unit: "ml",
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([feedingWithMl]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    const amountDuration = await screen.findByText(/120 ml · 18m/);
    expect(amountDuration).toBeTruthy();
  });

  it("shows only duration for breast feeding with no amount", async () => {
    const breastFeeding: Feeding = {
      ...baseFeeding,
      type: "breast_left",
      amount: null,
      amount_unit: null,
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([breastFeeding]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    const duration = await screen.findByText(/18m/);
    expect(duration).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("shows amount without unit when amount_unit is null", async () => {
    const feedingNoUnit: Feeding = {
      ...baseFeeding,
      amount: 5,
      amount_unit: null,
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve([feedingNoUnit]);
      return Promise.resolve([]);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    // Should render "5 · 18m" with no extra space before the dot
    const amountDuration = await screen.findByText(/5 · 18m/);
    expect(amountDuration).toBeTruthy();
    // Should not have a double space
    expect(screen.queryByText(/5  ·/)).toBeNull();
  });
});
