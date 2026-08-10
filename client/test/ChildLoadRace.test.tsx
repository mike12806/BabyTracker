/**
 * Landing on a section page before the children have loaded.
 *
 * `selectedChild` is null until `/children` comes back, so every section page
 * renders its "no child" placeholder first and its real body a moment later.
 * The two passes have to call the same hooks in the same order — a guard placed
 * above the page's `useMemo`s makes the second pass call more of them, which
 * React throws on. Nothing in the app catches that, so the tab goes blank.
 *
 * This is the ordinary path for anyone who reloads on a section page, reopens
 * the installed app, or taps an entry that deep-links in with `?edit=<id>`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import DiapersPage from "../src/pages/DiapersPage";
import FeedingsPage from "../src/pages/FeedingsPage";
import MedicationsPage from "../src/pages/MedicationsPage";
import SleepPage from "../src/pages/SleepPage";
import TemperaturePage from "../src/pages/TemperaturePage";
import TummyTimePage from "../src/pages/TummyTimePage";
import type { Child, DiaperChange } from "../src/types/models";

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

import { ChildProvider } from "../src/hooks/useChildren";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { api } from "../src/api/client";

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

const diaper: DiaperChange = {
  id: 7,
  child_id: 1,
  time: "2024-12-01T09:00:00Z",
  type: "wet",
  color: "yellow",
  notes: null,
  created_at: "2024-12-01T09:00:00Z",
  updated_at: "2024-12-01T09:00:00Z",
};

/** The real provider, so `selectedChild` goes null -> child as it does in the app. */
function renderPage(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <ChildProvider>
            <Routes>
              <Route path={path.split("?")[0]} element={element} />
            </Routes>
          </ChildProvider>
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === "/children") return [child] as never;
    if (url === "/settings") return { default_child_id: 1 } as never;
    if (url.startsWith("/diaper-changes/")) return diaper as never;
    if (url.startsWith("/diaper-changes")) return [diaper] as never;
    return [] as never;
  });
});

const pages: Array<[string, string, React.ReactElement, string]> = [
  ["diapers", "/diapers", <DiapersPage />, "Diaper Changes"],
  ["feedings", "/feedings", <FeedingsPage />, "Feedings"],
  ["medications", "/medications", <MedicationsPage />, "Medications"],
  ["sleep", "/sleep", <SleepPage />, "Sleep"],
  ["temperature", "/temperature", <TemperaturePage />, "Temperature"],
  ["tummy time", "/tummy-time", <TummyTimePage />, "Tummy Time"],
];

describe("landing on a section page before the children load", () => {
  it.each(pages)("renders %s once the child arrives", async (_name, path, element, heading) => {
    renderPage(path, element);

    // The placeholder renders first; the page body must survive the swap.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument(),
    );
  });

  it("opens the diaper edit form from an ?edit= deep link", async () => {
    renderPage("/diapers?edit=7", <DiapersPage />);

    expect(await screen.findByText("Edit Diaper Change")).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith("/diaper-changes/7");
  });
});
