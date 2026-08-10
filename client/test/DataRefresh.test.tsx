import { useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Startup liveness probe — resolves false so no extra refresh is triggered.
  probeLiveness: vi.fn(async () => false),
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

import Dashboard from "../src/pages/Dashboard";
import QuickLogDialog, { type QuickLogCategory } from "../src/components/QuickLogDialog";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { useChildren } from "../src/hooks/useChildren";
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();

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

/**
 * Mirrors Layout: the quick-log dialog behind the bottom-nav FAB lives outside
 * the routed page, so saving from it can't call back into the Dashboard.
 */
function AppShell() {
  const [category, setCategory] = useState<QuickLogCategory | null>(null);
  return (
    <DataRefreshProvider>
      <Dashboard />
      <button onClick={() => setCategory("feed")}>fab log feeding</button>
      <QuickLogDialog category={category} onClose={() => setCategory(null)} />
    </DataRefreshProvider>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

function feedingFetchCount(): number {
  return mockApi.get.mock.calls.filter(([url]) => String(url).includes("/feedings")).length;
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
  mockApi.post.mockResolvedValue({});
});

describe("Dashboard refresh after logging from outside the page", () => {
  it("refetches when an entry is saved from a dialog rendered outside the Dashboard", async () => {
    const user = userEvent.setup();
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await user.click(screen.getByRole("button", { name: /fab log feeding/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockApi.post).toHaveBeenCalledWith("/feedings", expect.objectContaining({ child_id: 1 }));
    await waitFor(() => expect(feedingFetchCount()).toBe(2));
  });

  it("does not refetch when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await user.click(screen.getByRole("button", { name: /fab log feeding/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(feedingFetchCount()).toBe(1);
  });

  it("refetches when the app becomes visible again", async () => {
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(feedingFetchCount()).toBe(2));
  });

  it("does not refetch while a form is open", async () => {
    const user = userEvent.setup();
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await user.click(screen.getByRole("button", { name: /fab log feeding/i }));
    await screen.findByRole("dialog");

    // A native date picker or the keyboard blurs and re-focuses the window
    // while the user is filling the form — that must not rebuild the page.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(feedingFetchCount()).toBe(1);
  });

  it("runs the held-back refresh once the form is closed", async () => {
    const user = userEvent.setup();
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await user.click(screen.getByRole("button", { name: /fab log feeding/i }));
    await screen.findByRole("dialog");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(feedingFetchCount()).toBe(1);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await act(async () => {
      document.dispatchEvent(new Event("focusout"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(feedingFetchCount()).toBe(2));
  });

  it("throttles duplicate refreshes when visibilitychange and focus both fire", async () => {
    render(<AppShell />, { wrapper: Wrapper });

    await waitFor(() => expect(feedingFetchCount()).toBe(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(feedingFetchCount()).toBe(2));
    expect(feedingFetchCount()).toBe(2);
  });
});
