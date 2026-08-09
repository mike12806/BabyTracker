import { act, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { ComponentType } from "react";
import type { Child } from "../src/types/models";

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

import GrowthPage from "../src/pages/GrowthPage";
import TemperaturePage from "../src/pages/TemperaturePage";
import TimersPage from "../src/pages/TimersPage";
import MedicationsPage from "../src/pages/MedicationsPage";
import TodosPage from "../src/pages/TodosPage";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { NotificationProvider } from "../src/hooks/useNotification";
import { useChildren } from "../src/hooks/useChildren";
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();

const child: Child = {
  id: 1,
  first_name: "Nolan",
  last_name: "Faherty",
  birth_date: "2026-01-04",
  picture_url: null,
  picture_content_type: null,
  created_at: "2026-01-04T12:00:00Z",
  updated_at: "2026-01-04T12:00:00Z",
};

/**
 * Every page here loads on mount and on child change. These are the ones that
 * used to stop there, so an installed app left on Medications or Growth kept
 * showing whatever it had fetched hours earlier.
 */
const pages: Array<{ name: string; Component: ComponentType; endpoint: string }> = [
  { name: "GrowthPage", Component: GrowthPage, endpoint: "/growth" },
  { name: "TemperaturePage", Component: TemperaturePage, endpoint: "/temperature" },
  { name: "TimersPage", Component: TimersPage, endpoint: "/timers" },
  { name: "MedicationsPage", Component: MedicationsPage, endpoint: "/medications" },
  { name: "TodosPage", Component: TodosPage, endpoint: "/todos" },
];

function renderPage(Component: ComponentType) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <NotificationProvider>
            <Component />
          </NotificationProvider>
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function fetchCount(endpoint: string): number {
  return mockApi.get.mock.calls.filter(([url]) => String(url).startsWith(endpoint)).length;
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

describe.each(pages)("$name staleness", ({ Component, endpoint }) => {
  it("refetches when the app is reopened", async () => {
    renderPage(Component);
    await waitFor(() => expect(fetchCount(endpoint)).toBe(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(fetchCount(endpoint)).toBe(2));
  });

  it("refetches when the page is restored from the back/forward cache", async () => {
    renderPage(Component);
    await waitFor(() => expect(fetchCount(endpoint)).toBe(1));

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });

    await waitFor(() => expect(fetchCount(endpoint)).toBe(2));
  });
});

describe("an app left open in front of the user", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches on its own without waiting to be re-opened", async () => {
    // Visibility events only fire on leaving and coming back. A tablet propped
    // on the changing table never fires one, so without a poll it would show
    // the morning's numbers all afternoon.
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => expect(fetchCount("/todos")).toBe(2));
  });

  it("does not poll while the app is in the background", async () => {
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Coming back fires `visibilitychange` and refetches then; burning requests
    // (and radio wake-ups) on a backgrounded phone buys nothing.
    expect(fetchCount("/todos")).toBe(1);
    hidden.mockRestore();
  });

  it("does not rebuild the page under an open form", async () => {
    const { container } = renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchCount("/todos")).toBe(1);
  });
});
