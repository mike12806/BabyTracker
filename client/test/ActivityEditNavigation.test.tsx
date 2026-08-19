import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ActivityPage from "../src/pages/ActivityPage";
import FeedingsPage from "../src/pages/FeedingsPage";
import Dashboard from "../src/pages/Dashboard";
import type { Child, Feeding } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
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

const feeding: Feeding = {
  id: 42,
  child_id: 1,
  type: "bottle_formula",
  start_time: "2024-12-01T09:00:00Z",
  end_time: null,
  amount: 4,
  amount_unit: "oz",
  notes: null,
  created_at: "2024-12-01T09:00:00Z",
  updated_at: "2024-12-01T09:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <LocationProbe />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/feedings" element={<FeedingsPage />} />
          </Routes>
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
});

describe("tapping an activity entry", () => {
  it("navigates from the activity feed to the entry's section page in edit mode", async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url.startsWith("/activity")) {
        return {
          total: 1,
          offset: 0,
          limit: 50,
          results: [
            {
              id: 42,
              activity_type: "Feeding",
              event_time: "2024-12-01T09:00:00Z",
              detail: "bottle formula",
              child_name: "Emma",
              logged_by: "Test User",
            },
          ],
        } as never;
      }
      if (url === "/feedings/42") return feeding as never;
      if (url.startsWith("/feedings")) return [feeding] as never;
      return [] as never;
    });

    renderApp("/activity");

    const card = await screen.findByRole("button", { name: /Edit Feeding at/i });
    await userEvent.click(card);

    // Lands on the feedings page with the entry's form already open.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/feedings"),
    );
    expect(await screen.findByText("Edit Feeding")).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith("/feedings/42");
  });

  it("navigates from the dashboard's recent activity to the entry in edit mode", async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === "/feedings/42") return feeding as never;
      if (url.startsWith("/feedings")) return [feeding] as never;
      return [] as never;
    });

    renderApp("/");

    const row = await screen.findByRole("button", {
      name: /Edit Bottle Formula · 118 mL at/i,
    });
    await userEvent.click(row);

    expect(await screen.findByText("Edit Feeding")).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith("/feedings/42");
  });

  it("opens the edit form for an entry that is not in the page's loaded list", async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === "/feedings/42") return feeding as never;
      // The list request deliberately omits entry 42 — the activity feed pages
      // back further than a section page loads.
      if (url.startsWith("/feedings")) return [] as never;
      return [] as never;
    });

    renderApp("/feedings?edit=42");

    expect(await screen.findByText("Edit Feeding")).toBeInTheDocument();
    // The param is dropped so a refresh or a return visit does not reopen it.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/feedings"),
    );
  });

  it("surfaces an error instead of the form when the entry cannot be loaded", async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === "/feedings/99") throw new Error("Not found");
      return [] as never;
    });

    renderApp("/feedings?edit=99");

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith("/feedings/99"));
    expect(screen.queryByText("Edit Feeding")).not.toBeInTheDocument();
  });
});
