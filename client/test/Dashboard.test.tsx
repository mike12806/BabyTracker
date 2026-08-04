import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function fetchCountFor(resource: string): number {
  return mockApi.get.mock.calls.filter(([url]) => String(url).includes(resource)).length;
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
  type: "bottle_formula",
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

    expect(await screen.findByText(/4 oz/)).toBeTruthy();
    expect(screen.getByText(/18m/)).toBeTruthy();
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

    expect(await screen.findByText(/120 ml/)).toBeTruthy();
    expect(screen.getByText(/18m/)).toBeTruthy();
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

    expect(await screen.findByText(/18m/)).toBeTruthy();
    expect(screen.getByText("Breast Left")).toBeTruthy();
    expect(screen.queryByText(/oz/)).toBeNull();
    expect(screen.queryByText(/ml/)).toBeNull();
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

    expect(await screen.findByText("Bottle Formula · 5")).toBeTruthy();
    expect(screen.getByText(/18m/)).toBeTruthy();
    expect(screen.queryByText(/5 oz/)).toBeNull();
    expect(screen.queryByText(/5 ml/)).toBeNull();
  });
});

describe("Dashboard – quick action buttons", () => {
  it("renders the quick action buttons with their supporting text", async () => {
    render(<Dashboard />, { wrapper: Wrapper });

    expect(await screen.findByRole("button", { name: /^feeding$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^diaper$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sleep$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^note$/i })).toHaveTextContent(/quick journal/i);
  });

  it("opens the quick-log feeding dialog when the Feeding button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^feeding$/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /log feeding/i })).toBeTruthy();
  });

  it("opens the quick-log diaper dialog when the Diaper button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^diaper$/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /log diaper/i })).toBeTruthy();
  });

  it("opens the quick-log sleep dialog when the Sleep button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^sleep$/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /log sleep/i })).toBeTruthy();
  });

  it("submits the feeding form, calls api.post, and refreshes dashboard data", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({});
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^feeding$/i }));

    // Quick-log dialog prefills start_time with "now", so no typing needed
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockApi.post).toHaveBeenCalledWith(
      "/feedings",
      expect.objectContaining({ child_id: 1, type: "bottle_formula" })
    );
    // Dashboard data should be refetched, not just loaded once on mount
    await waitFor(() => expect(fetchCountFor("/feedings")).toBe(2));
  });

  it("submits the diaper form, calls api.post, and refreshes dashboard data", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({});
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^diaper$/i }));

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockApi.post).toHaveBeenCalledWith(
      "/diaper-changes",
      expect.objectContaining({ child_id: 1, type: "wet" })
    );
    await waitFor(() => expect(fetchCountFor("/diaper-changes")).toBe(2));
  });

  it("submits the sleep form, calls api.post, and refreshes dashboard data", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({});
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^sleep$/i }));

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Quick-log sleep defaults to a nap
    expect(mockApi.post).toHaveBeenCalledWith(
      "/sleep",
      expect.objectContaining({ child_id: 1, is_nap: 1 })
    );
    await waitFor(() => expect(fetchCountFor("/sleep")).toBe(2));
  });

  it("closes the feeding dialog when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("button", { name: /^feeding$/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
