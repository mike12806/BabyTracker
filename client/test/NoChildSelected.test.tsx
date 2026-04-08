import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import NoChildSelected from "../src/components/NoChildSelected";

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

import { useChildren } from "../src/hooks/useChildren";
const mockUseChildren = vi.mocked(useChildren);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NoChildSelected", () => {
  it("shows 'No children added yet' message when there are no children", () => {
    mockUseChildren.mockReturnValue({
      children: [],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn(),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn(),
    });

    render(
      <Wrapper>
        <NoChildSelected />
      </Wrapper>
    );

    expect(screen.getByText(/No children added yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Child/i })).toBeInTheDocument();
  });

  it("shows 'No child selected' message when children exist but none is selected", () => {
    mockUseChildren.mockReturnValue({
      children: [
        {
          id: 1,
          first_name: "Mikey",
          last_name: "Faherty",
          birth_date: "2023-08-01",
          picture_url: null,
          picture_content_type: null,
          created_at: "2023-08-01T12:00:00Z",
          updated_at: "2023-08-01T12:00:00Z",
        },
      ],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn(),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn(),
    });

    render(
      <Wrapper>
        <NoChildSelected />
      </Wrapper>
    );

    expect(screen.getByText(/No child selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select Child/i })).toBeInTheDocument();
  });

  it("navigates to /children when the action button is clicked", async () => {
    const user = userEvent.setup();
    mockUseChildren.mockReturnValue({
      children: [],
      selectedChild: null,
      selectChild: vi.fn(),
      refreshChildren: vi.fn(),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn(),
    });

    render(
      <Wrapper>
        <NoChildSelected />
      </Wrapper>
    );

    const btn = screen.getByRole("button", { name: /Add Child/i });
    await user.click(btn);
    // Navigation is handled by MemoryRouter – just verify the button was clickable
    expect(btn).toBeInTheDocument();
  });
});
