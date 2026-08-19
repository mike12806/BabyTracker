import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import Dashboard from "../src/pages/Dashboard";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => true),
  api: { get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useChildren", () => ({ useChildren: vi.fn() }));

import { useChildren } from "../src/hooks/useChildren";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { api } from "../src/api/client";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <DataRefreshProvider>{children}</DataRefreshProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const child: Child = {
  id: 1,
  first_name: "Mikey",
  last_name: "Faherty",
  birth_date: "2023-08-01",
  picture_url: null,
  picture_content_type: "image/jpeg",
  created_at: "2023-08-01T12:00:00Z",
  updated_at: "2023-08-01T12:00:00Z",
};

const NOTE = "Mikey had 7 feeds and 13h of sleep yesterday. Steady week — you two are doing this well.";

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
});

describe("Dashboard – the hero card", () => {
  it("leads with his name and his photo", async () => {
    mockApi.get.mockResolvedValue([]);
    render(<Dashboard />, { wrapper: Wrapper });

    const photo = (await screen.findByAltText("Mikey")) as HTMLImageElement;
    expect(photo.getAttribute("src")).toContain("/api/children/1/photo");
  });

  it("shows the note the server wrote, marked as AI-written", async () => {
    mockApi.get.mockResolvedValue([]);
    mockApi.getOptional.mockResolvedValue({ note: { body: NOTE, source: "ai" } });

    render(<Dashboard />, { wrapper: Wrapper });
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.getByTitle("Written by AI")).toBeInTheDocument();
  });

  it("does not mark a fallback-template note as AI-written", async () => {
    mockApi.get.mockResolvedValue([]);
    mockApi.getOptional.mockResolvedValue({ note: { body: NOTE, source: "fallback" } });

    render(<Dashboard />, { wrapper: Wrapper });
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByTitle("Written by AI")).not.toBeInTheDocument();
  });

  it("reads the note once per load, never per render", async () => {
    mockApi.get.mockResolvedValue([]);
    render(<Dashboard />, { wrapper: Wrapper });

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const noteCalls = mockApi.getOptional.mock.calls.filter(([url]) =>
      String(url).includes("/daily-note"),
    );
    expect(noteCalls).toHaveLength(1);
  });

  it("still renders the page when the note request fails", async () => {
    mockApi.get.mockResolvedValue([]);
    mockApi.getOptional.mockRejectedValue(new Error("404"));

    render(<Dashboard />, { wrapper: Wrapper });

    // The numbers are what matter; the blurb is decoration and must not be able
    // to take them down with it.
    expect(await screen.findByText("Today so far")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });
});
