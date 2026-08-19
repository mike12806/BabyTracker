import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => true),
  api: { get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })), post: vi.fn(),
    postSlow: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../src/hooks/useChildren", () => ({ useChildren: vi.fn() }));
vi.mock("../src/hooks/useTheme", () => ({ useThemeMode: vi.fn() }));
vi.mock("../src/hooks/useVolumeUnit", () => ({ useVolumeUnit: vi.fn() }));

import Layout from "../src/components/Layout";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { NotificationProvider } from "../src/hooks/useNotification";
import { useAuth } from "../src/hooks/useAuth";
import { useChildren } from "../src/hooks/useChildren";
import { useThemeMode } from "../src/hooks/useTheme";
import { useVolumeUnit } from "../src/hooks/useVolumeUnit";
import { api } from "../src/api/client";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 1, email: "mike@example.com", name: "Mike" }, loading: false });
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
        <NotificationProvider>
          <DataRefreshProvider>
            <Layout />
          </DataRefreshProvider>
        </NotificationProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Opens the drawer and returns the (first, mobile) build-info element. */
function openDrawerAndGetBuildLine(): HTMLElement {
  fireEvent.click(screen.getByLabelText("open navigation drawer"));
  return screen.getAllByText(/^Build /)[0];
}

describe("the buried daily-note regenerate action", () => {
  it("is not visible by default", () => {
    renderLayout();
    openDrawerAndGetBuildLine();
    expect(screen.queryByText("Regenerate today's note")).not.toBeInTheDocument();
  });

  it("stays hidden for a few taps", () => {
    renderLayout();
    const buildLine = openDrawerAndGetBuildLine();
    fireEvent.click(buildLine);
    fireEvent.click(buildLine);
    fireEvent.click(buildLine);
    expect(screen.queryByText("Regenerate today's note")).not.toBeInTheDocument();
  });

  it("reveals after five taps on the build line", () => {
    renderLayout();
    const buildLine = openDrawerAndGetBuildLine();
    for (let i = 0; i < 5; i++) fireEvent.click(buildLine);
    // The same drawer content is mounted for both the mobile and desktop
    // layout, so the revealed button legitimately exists twice.
    expect(screen.getAllByText("Regenerate today's note").length).toBeGreaterThan(0);
  });

  it("calls the refresh endpoint and reports what it wrote, on tap", async () => {
    mockApi.postSlow.mockResolvedValue({
      written: [{ child_id: 1, source: "ai" }, { child_id: 2, source: "fallback" }],
    });
    renderLayout();
    const buildLine = openDrawerAndGetBuildLine();
    for (let i = 0; i < 5; i++) fireEvent.click(buildLine);

    fireEvent.click(screen.getAllByText("Regenerate today's note")[0]);

    await waitFor(() => expect(mockApi.postSlow).toHaveBeenCalledWith("/daily-notes/refresh", {}));
    expect(await screen.findByText("Wrote 2 notes (1 from AI).")).toBeInTheDocument();
  });

  it("reports failure without crashing the drawer", async () => {
    mockApi.postSlow.mockRejectedValue(new Error("Failed to regenerate notes."));
    renderLayout();
    const buildLine = openDrawerAndGetBuildLine();
    for (let i = 0; i < 5; i++) fireEvent.click(buildLine);

    fireEvent.click(screen.getAllByText("Regenerate today's note")[0]);

    expect(await screen.findByText("Failed to regenerate notes.")).toBeInTheDocument();
  });

  it("hides again once the drawer is closed and reopened", () => {
    renderLayout();
    const buildLine = openDrawerAndGetBuildLine();
    for (let i = 0; i < 5; i++) fireEvent.click(buildLine);
    expect(screen.getAllByText("Regenerate today's note").length).toBeGreaterThan(0);

    // Mobile drawer unmounts its content on close, which is when the tap
    // count actually resets.
    fireEvent.keyDown(document.body, { key: "Escape" });

    openDrawerAndGetBuildLine();
    expect(screen.queryByText("Regenerate today's note")).not.toBeInTheDocument();
  });
});
