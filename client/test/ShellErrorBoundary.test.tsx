/**
 * A page that throws must not take the shell with it.
 *
 * The section-page hook-order crash blanked the entire app, so there was no
 * nav to escape with and nothing on screen naming the problem. The boundary
 * inside Layout keeps the chrome alive around the failure.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  probeLiveness: vi.fn(async () => false),
  api: { get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  API_BASE: "/api",
}));
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

function Boom(): never {
  throw new Error("Rendered more hooks than during the previous render.");
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
  consoleError.mockRestore();
});

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/diapers"]}>
      <ThemeProvider theme={theme}>
        <DataRefreshProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/diapers" element={<Boom />} />
              <Route path="/feedings" element={<p>Feedings page</p>} />
            </Route>
          </Routes>
        </DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("a page crashing inside the shell", () => {
  it("shows the error rather than a blank screen", () => {
    renderShell();

    expect(screen.getByText("This page failed to load")).toBeInTheDocument();
    expect(
      screen.getByText("Rendered more hooks than during the previous render."),
    ).toBeInTheDocument();
  });

  it("leaves the nav in place so the user can get out", async () => {
    renderShell();

    // The nav is the escape hatch the white screen took away.
    const feedings = screen.getAllByText("Feedings")[0];
    await userEvent.click(feedings);

    expect(await screen.findByText("Feedings page")).toBeInTheDocument();
    expect(screen.queryByText("This page failed to load")).not.toBeInTheDocument();
  });
});
