import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../src/api/client")>("../src/api/client");
  // These cases drive the banner through `noteResponse` directly. The real
  // startup probe would fetch (and fail) in jsdom, marking the app offline
  // before the case under test has said anything.
  return { ...actual, API_BASE: "/api", probeLiveness: vi.fn(async () => false) };
});

vi.mock("../src/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../src/hooks/useChildren", () => ({ useChildren: vi.fn() }));
vi.mock("../src/hooks/useTheme", () => ({ useThemeMode: vi.fn() }));
vi.mock("../src/hooks/useVolumeUnit", () => ({ useVolumeUnit: vi.fn() }));

import Layout from "../src/components/Layout";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { useAuth } from "../src/hooks/useAuth";
import { useChildren } from "../src/hooks/useChildren";
import { useThemeMode } from "../src/hooks/useTheme";
import { useVolumeUnit } from "../src/hooks/useVolumeUnit";
import { noteResponse, resetFreshness } from "../src/api/freshness";

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

/** A reply as the network — or the service worker's offline cache — returns one. */
function reply(servedAt: Date): Response {
  return { headers: new Headers({ date: servedAt.toUTCString() }) } as Response;
}

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

beforeEach(() => {
  vi.clearAllMocks();
  resetFreshness();
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

afterEach(() => {
  resetFreshness();
});

describe("stale data banner", () => {
  it("stays out of the way while data is coming from the server", async () => {
    renderLayout();
    await act(async () => {
      noteResponse(reply(new Date()));
    });

    expect(screen.queryByText(/showing saved data/i)).toBeNull();
  });

  it("tells the user when the app is serving data from its offline cache", async () => {
    renderLayout();

    // Calibrate on a live reply, then get one the service worker had kept from
    // three hours ago — which otherwise renders identically to a live one.
    await act(async () => {
      noteResponse(reply(new Date()));
      noteResponse(reply(new Date(Date.now() - 3 * 60 * 60000)));
    });

    const banner = await screen.findByText(/showing saved data from 3h ago/i);
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("takes the banner down once the connection comes back", async () => {
    renderLayout();
    await act(async () => {
      noteResponse(reply(new Date()));
      noteResponse(reply(new Date(Date.now() - 3 * 60 * 60000)));
    });
    await screen.findByText(/showing saved data/i);

    await act(async () => {
      noteResponse(reply(new Date()));
    });

    await waitFor(() => expect(screen.queryByText(/showing saved data/i)).toBeNull());
  });
});
