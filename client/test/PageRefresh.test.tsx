import { act, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { ComponentType } from "react";
import type { Child } from "../src/types/models";

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

import GrowthPage from "../src/pages/GrowthPage";
import TemperaturePage from "../src/pages/TemperaturePage";
import TimersPage from "../src/pages/TimersPage";
import MedicationsPage from "../src/pages/MedicationsPage";
import TodosPage from "../src/pages/TodosPage";
import { DataRefreshProvider, FOREGROUND_POLL_MS, STALE_RETRY_MS } from "../src/hooks/useDataRefresh";
import { NotificationProvider } from "../src/hooks/useNotification";
import { useChildren } from "../src/hooks/useChildren";
import { api, pingServer } from "../src/api/client";
import { markOffline, resetFreshness } from "../src/api/freshness";

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
      await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    });

    await waitFor(() => expect(fetchCount("/todos")).toBe(2));
  });

  it("does not poll while the app is in the background", async () => {
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
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
      await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    });

    expect(fetchCount("/todos")).toBe(1);
  });

  it("picks a held refresh back up once the form is gone", async () => {
    // `focusout` is the responsive release, but it doesn't always fire — a
    // dialog dismissed by tapping the backdrop with nothing focused inside it
    // fires none — so the poll tick has to be able to pick it up unaided.
    const { container } = renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    });
    expect(fetchCount("/todos")).toBe(1);

    // Form closed, with no focusout of its own.
    input.remove();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    });

    await waitFor(() => expect(fetchCount("/todos")).toBe(2));
  });
});

describe("an app whose refresh failed", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetFreshness();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetFreshness();
  });

  it("refreshes as soon as a retry ping finds the server reachable", async () => {
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    // A refresh failed, so the screen is only as current as the last one that
    // worked. Sitting on that until the next ordinary poll is exactly the
    // "opened it and it was out of date" case.
    await act(async () => {
      markOffline();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_RETRY_MS);
    });

    await waitFor(() => expect(fetchCount("/todos")).toBe(2));
  });

  it("does not refetch pages while the server stays unreachable", async () => {
    // The point of pinging first: a full refresh into a dead network is a
    // dozen doomed requests and an error toast on every mounted page, every
    // cycle. The ping absorbs the failure silently until it succeeds.
    vi.mocked(pingServer).mockResolvedValue(false);
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      markOffline();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_RETRY_MS * 3);
    });

    expect(fetchCount("/todos")).toBe(1);
    expect(vi.mocked(pingServer).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not ping on that cadence while data is fresh", async () => {
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_RETRY_MS * 3);
    });

    expect(fetchCount("/todos")).toBe(1);
    expect(pingServer).not.toHaveBeenCalled();
  });

  it("does not ping while the tab is in the background", async () => {
    // A hidden tab is not waiting on anything, and the refresh behind the ping
    // would decline to run anyway — so every tick was a request asked purely
    // to have its answer discarded, for as long as the tab sat there.
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      markOffline();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_RETRY_MS * 3);
    });

    expect(pingServer).not.toHaveBeenCalled();

    // Coming back to it resumes, so nothing is stuck in the background state.
    hidden.mockReturnValue("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_RETRY_MS);
    });
    expect(pingServer).toHaveBeenCalled();
    hidden.mockRestore();
  });

  it("refetches the moment the connection comes back", async () => {
    renderPage(TodosPage);
    await waitFor(() => expect(fetchCount("/todos")).toBe(1));

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(fetchCount("/todos")).toBe(2));
  });
});
