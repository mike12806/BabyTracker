import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: { get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../src/hooks/useChildren", () => ({ useChildren: vi.fn() }));
vi.mock("../src/hooks/useTheme", () => ({ useThemeMode: vi.fn() }));
vi.mock("../src/hooks/useVolumeUnit", () => ({ useVolumeUnit: vi.fn() }));

import Layout from "../src/components/Layout";
import { DataRefreshProvider, useDataRefresh } from "../src/hooks/useDataRefresh";
import { useAuth } from "../src/hooks/useAuth";
import { useChildren } from "../src/hooks/useChildren";
import { useThemeMode } from "../src/hooks/useTheme";
import { useVolumeUnit } from "../src/hooks/useVolumeUnit";
import { isUserBusy } from "../src/utils/interruptions";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 1, email: "a@b.c", name: "A" }, loading: false });
  vi.mocked(useChildren).mockReturnValue({
    children: [child],
    selectedChild: child,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(useThemeMode).mockReturnValue({ preference: "system", setPreference: vi.fn(), mode: "light" });
  vi.mocked(useVolumeUnit).mockReturnValue({ unit: "ml", setUnit: vi.fn() });
});

function renderLayout() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <Layout />
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** The centre "Log" button in the bottom nav, which has only an icon. */
function logFab(): HTMLElement {
  const icon = document.querySelector('[data-testid="AddRoundedIcon"]');
  if (!icon?.parentElement) throw new Error("Log FAB not found");
  return icon.parentElement;
}

/** Renders `refreshKey`, so a refresh reaching the tree is directly observable. */
function RefreshProbe() {
  const { refreshKey } = useDataRefresh();
  return <span data-testid="refresh-key">{refreshKey}</span>;
}

function renderShell() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <Layout />
          <RefreshProbe />
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("refreshes inside the real app shell", () => {
  it("still happen when the app is brought back to the foreground", async () => {
    // Regression test for a refresh path that was dead in the running app while
    // every existing test passed: those render a page on its own, and the thing
    // that broke it lives in the shell around them. `SwipeableDrawer` keeps its
    // paper — role="dialog" and all — mounted while closed, so the interruption
    // check saw a modal on every screen and held every refresh forever.
    renderShell();
    expect(screen.getByTestId("refresh-key")).toHaveTextContent("0");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByTestId("refresh-key")).toHaveTextContent("1");
  });

  it("are held while the Log sheet is genuinely open", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(logFab());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Rebuilding every list under an open sheet buys nothing, and a request
    // that fails mid-form can bounce the app through re-auth.
    expect(screen.getByTestId("refresh-key")).toHaveTextContent("0");
  });

  it("still happen when a checkbox — not a form — is what has focus", async () => {
    // Regression test: the dashboard and to-do list check off items with a
    // plain <input type="checkbox"> that sits right in the page, not inside a
    // dialog. iOS leaves it focused across a background/foreground cycle, and
    // `isUserBusy` used to treat any focused <input> as a form in progress —
    // holding this refresh (and the foreground poll) hostage indefinitely.
    renderShell();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.appendChild(checkbox);
    checkbox.focus();

    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(screen.getByTestId("refresh-key")).toHaveTextContent("1");
    } finally {
      document.body.removeChild(checkbox);
    }
  });
});

describe("the Log sheet and background refreshes", () => {
  it("counts as an interruption while it is open", async () => {
    // The sheet is a modal in behaviour but hand-rolled in markup, so it has to
    // declare the role itself. Without it `isUserBusy` sees nothing, and a
    // refresh arriving while the sheet is open rebuilds the page underneath.
    const user = userEvent.setup();
    renderLayout();

    expect(isUserBusy()).toBe(false);

    await user.click(logFab());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(isUserBusy()).toBe(true);
  });

  it("stops counting once it is dismissed", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(logFab());
    expect(isUserBusy()).toBe(true);

    await user.click(logFab());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isUserBusy()).toBe(false);
  });
});

describe("isUserBusy and a focused input outside any dialog", () => {
  function withFocused(type: string, run: () => void) {
    const input = document.createElement("input");
    input.type = type;
    document.body.appendChild(input);
    input.focus();
    try {
      run();
    } finally {
      document.body.removeChild(input);
    }
  }

  it("does not count a focused checkbox or radio — nothing typed to lose", () => {
    withFocused("checkbox", () => expect(isUserBusy()).toBe(false));
    withFocused("radio", () => expect(isUserBusy()).toBe(false));
  });

  it("still counts a focused text-entry field, e.g. a datetime picker", () => {
    withFocused("text", () => expect(isUserBusy()).toBe(true));
    withFocused("datetime-local", () => expect(isUserBusy()).toBe(true));
    withFocused("number", () => expect(isUserBusy()).toBe(true));
  });
});
