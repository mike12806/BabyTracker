import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ChildrenPage from "../src/pages/ChildrenPage";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
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

import { useChildren } from "../src/hooks/useChildren";
const mockUseChildren = vi.mocked(useChildren);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
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
  mockUseChildren.mockReturnValue({
    children: [baseChild],
    selectedChild: baseChild,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
});

describe("ChildrenPage – birth date display", () => {
  it("displays birth_date of 2023-08-01 as August 1 without UTC offset shift", () => {
    render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    // The displayed date should include "8/1" or "Aug" (locale-dependent) but
    // must NOT slip back to July 31 due to UTC-to-local conversion.
    const bornText = screen.getByText(/born/i);
    expect(bornText.textContent).not.toMatch(/7\/31/);
    // Build what the correct local date string looks like for 2023-08-01
    const expected = new Date(2023, 7, 1).toLocaleDateString(); // month is 0-indexed
    expect(bornText.textContent).toContain(expected);
  });
});

describe("ChildrenPage – photo URL cache-busting", () => {
  it("uses updated_at as the photo version parameter, not a local counter", () => {
    const childWithPhoto: Child = {
      ...baseChild,
      picture_content_type: "image/jpeg",
      updated_at: "2024-03-01T10:00:00Z",
    };
    mockUseChildren.mockReturnValue({
      children: [childWithPhoto],
      selectedChild: childWithPhoto,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    const avatar = document.querySelector(`img[src*="/api/children/1/photo"]`) as HTMLImageElement | null;
    expect(avatar).not.toBeNull();
    expect(avatar!.src).toContain("v=");
    // Should contain the encoded updated_at timestamp, NOT a plain integer like ?v=0
    expect(avatar!.src).toContain(encodeURIComponent("2024-03-01T10:00:00Z"));
  });
});
