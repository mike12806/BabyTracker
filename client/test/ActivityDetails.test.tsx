import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ActivityPage from "../src/pages/ActivityPage";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })),
    post: vi.fn(),
    postSlow: vi.fn(),
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

const child: Child = {
  id: 1,
  first_name: "Emma",
  last_name: "Faherty",
  birth_date: "2024-06-15",
  picture_url: null,
  picture_content_type: null,
  created_at: "2024-06-15T12:00:00Z",
  updated_at: "2024-06-15T12:00:00Z",
};

const results = [
  {
    id: 1,
    activity_type: "Feeding",
    event_time: "2024-12-01T09:00:00Z",
    detail: "bottle formula",
    end_time: null,
    subtype: "bottle_formula",
    label: null,
    amount: 4,
    amount_unit: "oz",
    color: null,
    child_name: "Emma",
    logged_by: "Test User",
  },
  {
    id: 2,
    activity_type: "Diaper Change",
    event_time: "2024-12-01T08:30:00Z",
    detail: "solid (yellow)",
    end_time: null,
    subtype: "solid",
    label: null,
    amount: null,
    amount_unit: null,
    color: "yellow",
    child_name: "Emma",
    logged_by: "Test User",
  },
  {
    id: 3,
    activity_type: "Sleep",
    event_time: "2024-12-01T06:00:00Z",
    detail: "nap",
    end_time: "2024-12-01T07:30:00Z",
    subtype: "nap",
    label: null,
    amount: null,
    amount_unit: null,
    color: null,
    child_name: "Emma",
    logged_by: "Test User",
  },
];

function renderActivity() {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <ActivityPage />
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseChildren.mockReturnValue({
    children: [child],
    selectedChild: child,
    setSelectedChild: vi.fn(),
    loading: false,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useChildren>);
  mockApi.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/activity")) {
      return { total: results.length, offset: 0, limit: 50, results } as never;
    }
    return [] as never;
  });
});

describe("activity feed entry details", () => {
  it("shows how much a feeding was, in the unit the app displays", async () => {
    renderActivity();

    expect(await screen.findByText("Bottle (Formula)")).toBeInTheDocument();
    // Logged as 4 oz; shown in the default display unit.
    expect(screen.getByText("118 mL")).toBeInTheDocument();
  });

  it("shows a diaper's type with its colour, and how long a nap ran", async () => {
    renderActivity();

    expect(await screen.findByText("Solid · Yellow")).toBeInTheDocument();
    expect(screen.getByText("Nap")).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("reads the details out as part of each entry's name", async () => {
    renderActivity();

    expect(
      await screen.findByRole("button", { name: /Edit Feeding, Bottle \(Formula\), 118 mL at/i }),
    ).toBeInTheDocument();
  });
});
