import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import NoChildPlaceholder from "../src/components/NoChildPlaceholder";
import type { Child } from "../src/types/models";

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

import { useChildren } from "../src/hooks/useChildren";
const mockUseChildren = vi.mocked(useChildren);
const mockUseNavigate = vi.mocked(useNavigate);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

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

beforeEach(() => {
  vi.clearAllMocks();
  mockUseNavigate.mockReturnValue(vi.fn());
});

describe("NoChildPlaceholder", () => {
  it("shows a loading spinner while children are being fetched", () => {
    mockUseChildren.mockReturnValue({
      children: [],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: true,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Wrapper>
        <NoChildPlaceholder />
      </Wrapper>
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(/no children/i)).not.toBeInTheDocument();
  });

  it("shows 'No children added yet' with an Add a Child button when no children exist", () => {
    mockUseChildren.mockReturnValue({
      children: [],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Wrapper>
        <NoChildPlaceholder />
      </Wrapper>
    );

    expect(screen.getByText("No children added yet")).toBeInTheDocument();
    expect(screen.getByText("Add a child to start tracking.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add a child/i })).toBeInTheDocument();
  });

  it("navigates to /children when 'Add a Child' button is clicked", async () => {
    const mockNavigate = vi.fn();
    mockUseNavigate.mockReturnValue(mockNavigate);
    mockUseChildren.mockReturnValue({
      children: [],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    const user = userEvent.setup();
    render(
      <Wrapper>
        <NoChildPlaceholder />
      </Wrapper>
    );

    await user.click(screen.getByRole("button", { name: /add a child/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/children");
  });

  it("shows 'Select a child from the sidebar' when children exist but none selected", () => {
    mockUseChildren.mockReturnValue({
      children: [baseChild],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Wrapper>
        <NoChildPlaceholder />
      </Wrapper>
    );

    expect(screen.getByText("Select a child from the sidebar.")).toBeInTheDocument();
    expect(screen.queryByText("No children added yet")).not.toBeInTheDocument();
  });
});
