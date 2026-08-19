import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
import type { Child, Feeding, Pumping, Todo } from "../src/types/models";

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

  it("shows the amount in the display unit alongside duration", async () => {
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

    // Logged in ounces, shown in the unit the app displays: 4 oz = 118 mL.
    expect(await screen.findByText(/118 mL/)).toBeTruthy();
    expect(screen.getByText(/18m/)).toBeTruthy();
  });

  it("shows an amount already in the display unit unchanged", async () => {
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

    expect(await screen.findByText(/120 mL/)).toBeTruthy();
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

  it("reads an amount saved without a unit as the display unit", async () => {
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

    expect(await screen.findByText("Bottle Formula · 5 mL")).toBeTruthy();
    expect(screen.getByText(/18m/)).toBeTruthy();
    expect(screen.queryByText(/5 oz/)).toBeNull();
  });
});

describe("Dashboard – Today so far feeding total", () => {
  function todayAt(hour: number, minute = 0): string {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  function todayFeeding(id: number, amount: number | null, amount_unit: string | null, hour: number): Feeding {
    return { ...baseFeeding, id, amount, amount_unit, start_time: todayAt(hour), end_time: null };
  }

  function mockFeedings(feedings: Feeding[]) {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/feedings")) return Promise.resolve(feedings);
      return Promise.resolve([]);
    });
  }

  /** The tile that headlines today's feeding total. */
  async function feedTile(): Promise<HTMLElement> {
    const heading = await screen.findByText(/^(fed|feeds)$/);
    return heading.parentElement!.parentElement as HTMLElement;
  }

  it("totals the amount fed today in the display unit", async () => {
    mockFeedings([
      todayFeeding(1, 30, "cc", 11),
      todayFeeding(2, 20, "cc", 14),
      todayFeeding(3, 30, "cc", 17),
    ]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = await feedTile();
    expect(within(tile).getByText("fed")).toBeTruthy();
    expect(within(tile).getByText("80 mL")).toBeTruthy();
    expect(within(tile).getByText("3 feeds")).toBeTruthy();
  });

  it("normalizes to mL when the day mixes units", async () => {
    // 4 oz = 118.294 mL, + 30 mL + 20 cc = 168
    mockFeedings([
      todayFeeding(1, 4, "oz", 9),
      todayFeeding(2, 30, "ml", 13),
      todayFeeding(3, 20, "cc", 17),
    ]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = await feedTile();
    expect(within(tile).getByText("168 mL")).toBeTruthy();
    expect(within(tile).getByText("3 feeds")).toBeTruthy();
  });

  it("carries a solid's gram total alongside the volume", async () => {
    mockFeedings([todayFeeding(1, 60, "cc", 10), todayFeeding(2, 100, "g", 12)]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = await feedTile();
    expect(within(tile).getByText("60 mL")).toBeTruthy();
    expect(within(tile).getByText("2 feeds · 100 g")).toBeTruthy();
  });

  it("counts breastfeeding-only days, which record no amount", async () => {
    mockFeedings([
      { ...todayFeeding(1, null, null, 8), type: "breast_left" },
      { ...todayFeeding(2, null, null, 12), type: "breast_right" },
    ]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = await feedTile();
    expect(within(tile).getByText("feeds")).toBeTruthy();
    expect(within(tile).getByText("2")).toBeTruthy();
    expect(within(tile).getByText("today")).toBeTruthy();
  });

  it("ignores feedings from earlier days", async () => {
    mockFeedings([todayFeeding(1, 30, "cc", 11), { ...baseFeeding, id: 2, amount: 999, amount_unit: "cc" }]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = await feedTile();
    expect(within(tile).getByText("30 mL")).toBeTruthy();
    expect(within(tile).getByText("1 feed")).toBeTruthy();
  });
});

describe("Dashboard – Today so far pumping total", () => {
  function todayAt(hour: number): string {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  function pumping(id: number, amount: number | null, amount_unit: Pumping["amount_unit"], hour: number): Pumping {
    return {
      id,
      child_id: 1,
      start_time: todayAt(hour),
      end_time: null,
      side: "both",
      amount,
      amount_unit,
      notes: null,
      created_at: todayAt(hour),
      updated_at: todayAt(hour),
    };
  }

  function mockPumpings(pumpings: Pumping[]) {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/pumping")) return Promise.resolve(pumpings);
      return Promise.resolve([]);
    });
  }

  async function pumpTile(): Promise<HTMLElement> {
    const heading = await screen.findByText("pumped");
    return heading.parentElement!.parentElement as HTMLElement;
  }

  it("totals the amount pumped today in the unit it was recorded in", async () => {
    mockPumpings([pumping(1, 90, "ml", 7), pumping(2, 60, "ml", 13)]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = within(await pumpTile());
    expect(tile.getByText("150 mL")).toBeTruthy();
    expect(tile.getByText("2 sessions")).toBeTruthy();
  });

  it("normalizes to mL when the day mixes units", async () => {
    // 3 oz = 88.7205 mL, + 60 mL = 149
    mockPumpings([pumping(1, 3, "oz", 7), pumping(2, 60, "ml", 13)]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = within(await pumpTile());
    expect(tile.getByText("149 mL")).toBeTruthy();
  });

  it("falls back to the session count when no amount was recorded", async () => {
    mockPumpings([pumping(1, null, null, 7)]);

    render(<Dashboard />, { wrapper: Wrapper });

    const tile = within(await pumpTile());
    expect(tile.getByText("1")).toBeTruthy();
    expect(tile.getByText("1 session")).toBeTruthy();
  });
});

describe("Dashboard – to-do snapshot", () => {
  const baseTodo: Todo = {
    id: 7,
    child_id: 1,
    title: "Book hip ultrasound",
    notes: null,
    due_date: null,
    priority: "medium",
    completed: 0,
    completed_at: null,
    created_at: "2024-12-01T08:00:00Z",
    updated_at: "2024-12-01T08:00:00Z",
  };

  function mockTodos(todos: Todo[]) {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/todos")) return Promise.resolve(todos);
      return Promise.resolve([]);
    });
  }

  it("gives each task a labelled checkbox", async () => {
    mockTodos([baseTodo]);

    render(<Dashboard />, { wrapper: Wrapper });

    expect(await screen.findByRole("checkbox", { name: /book hip ultrasound/i })).toBeTruthy();
  });

  it("completes the task and refreshes the dashboard when the checkbox is ticked", async () => {
    const user = userEvent.setup();
    mockTodos([baseTodo]);
    mockApi.put.mockResolvedValue({});

    render(<Dashboard />, { wrapper: Wrapper });

    await user.click(await screen.findByRole("checkbox", { name: /book hip ultrasound/i }));

    expect(mockApi.put).toHaveBeenCalledWith("/todos/7", { completed: true });
    await waitFor(() => expect(fetchCountFor("/todos")).toBe(2));
  });

  it("keeps the ticked task on screen, struck through, until the refresh lands", async () => {
    const user = userEvent.setup();
    mockTodos([baseTodo]);
    mockApi.put.mockResolvedValue({});

    render(<Dashboard />, { wrapper: Wrapper });

    const checkbox = await screen.findByRole("checkbox", { name: /book hip ultrasound/i });
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(screen.getByText("Book hip ultrasound")).toHaveStyle({ textDecoration: "line-through" });
  });

  it("leaves the task active and reports the failure when the update fails", async () => {
    const user = userEvent.setup();
    mockTodos([baseTodo]);
    mockApi.put.mockRejectedValue(new Error("Network down"));

    render(<Dashboard />, { wrapper: Wrapper });

    const checkbox = await screen.findByRole("checkbox", { name: /book hip ultrasound/i });
    await user.click(checkbox);

    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.getByText("Book hip ultrasound")).toHaveStyle({ textDecoration: "none" });
  });

  it("makes the task row itself tappable to reach the full to-do list", async () => {
    mockTodos([baseTodo]);

    render(<Dashboard />, { wrapper: Wrapper });

    expect(await screen.findByRole("button", { name: /book hip ultrasound/i })).toBeTruthy();
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
