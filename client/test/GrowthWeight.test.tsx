import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import GrowthPage from "../src/pages/GrowthPage";
import type { Child, Growth } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })),
    post: vi.fn(),
    postSlow: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

import { api } from "../src/api/client";
import { useChildren } from "../src/hooks/useChildren";

const mockApi = vi.mocked(api);
const mockUseChildren = vi.mocked(useChildren);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

const child: Child = {
  id: 1,
  first_name: "Mikey",
  last_name: "Faherty",
  birth_date: "2026-08-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2026-08-01T12:00:00Z",
  updated_at: "2026-08-01T12:00:00Z",
};

const entry: Growth = {
  id: 9,
  child_id: 1,
  date: "2026-08-04",
  weight: 7.25,
  weight_unit: "lb",
  height: null,
  height_unit: null,
  head_circumference: null,
  head_circumference_unit: null,
  notes: null,
  created_at: "2026-08-04T12:00:00Z",
  updated_at: "2026-08-04T12:00:00Z",
};

function setEntries(entries: Growth[]): void {
  mockApi.get.mockResolvedValue(entries as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setEntries([]);
  mockApi.post.mockResolvedValue({} as never);
  mockApi.put.mockResolvedValue({} as never);
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

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Add Measurement" }));
  await screen.findByRole("dialog");
}

describe("GrowthPage – pounds and ounces", () => {
  it("saves a lb + oz pair as decimal pounds", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <GrowthPage />
      </Wrapper>
    );

    await openDialog(user);
    await user.type(screen.getByLabelText("Date *"), "2026-08-04");
    await user.type(screen.getByLabelText("Weight (lb)"), "7");
    await user.type(screen.getByLabelText("oz"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post.mock.calls[0][1]).toMatchObject({
      child_id: 1,
      weight: 7.25,
      weight_unit: "lb",
    });
  });

  it("saves an ounces-only weight in pounds", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <GrowthPage />
      </Wrapper>
    );

    await openDialog(user);
    await user.type(screen.getByLabelText("Date *"), "2026-08-04");
    await user.type(screen.getByLabelText("oz"), "12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post.mock.calls[0][1]).toMatchObject({ weight: 0.75, weight_unit: "lb" });
  });

  it("omits weight when both fields are left blank", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <GrowthPage />
      </Wrapper>
    );

    await openDialog(user);
    await user.type(screen.getByLabelText("Date *"), "2026-08-04");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post.mock.calls[0][1]).toMatchObject({ weight: null, weight_unit: null });
  });

  it("hides the ounces field for metric units", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <GrowthPage />
      </Wrapper>
    );

    await openDialog(user);
    // The first Unit select belongs to the weight row.
    await user.click(screen.getAllByRole("combobox", { name: /unit/i })[0]);
    await user.click(await screen.findByRole("option", { name: "kg" }));

    expect(screen.queryByLabelText("oz")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Weight")).toBeInTheDocument();
  });

  it("shows a stored decimal weight as lb + oz and round-trips it on edit", async () => {
    setEntries([entry]);
    const user = userEvent.setup();
    render(
      <Wrapper>
        <GrowthPage />
      </Wrapper>
    );

    expect(await screen.findAllByText("7 lb 4 oz")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /aug 4, 2026/i }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Weight (lb)")).toHaveValue(7);
    expect(screen.getByLabelText("oz")).toHaveValue(4);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    expect(mockApi.put.mock.calls[0][1]).toMatchObject({ weight: 7.25, weight_unit: "lb" });
  });
});
