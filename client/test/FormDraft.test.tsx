import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

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

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

import QuickLogDialog, { type QuickLogCategory } from "../src/components/QuickLogDialog";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { useChildren } from "../src/hooks/useChildren";
import { api } from "../src/api/client";
import { DRAFT_TTL_MS, loadDraft, saveDraft } from "../src/utils/formDraft";

const mockUseChildren = vi.mocked(useChildren);
const mockApi = vi.mocked(api);

const theme = createTheme();

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

/** Opening and closing the dialog, the way Layout and the Dashboard do. */
function Harness() {
  const [category, setCategory] = useState<QuickLogCategory | null>(null);
  return (
    <DataRefreshProvider>
      <button onClick={() => setCategory("note")}>open note</button>
      <QuickLogDialog category={category} onClose={() => setCategory(null)} />
    </DataRefreshProvider>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

function noteField(): HTMLElement {
  return screen.getByRole("textbox", { name: /^note/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUseChildren.mockReturnValue({
    children: [baseChild],
    selectedChild: baseChild,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
  mockApi.post.mockResolvedValue({});
});

describe("in-progress form drafts", () => {
  it("keeps what was typed when the page is torn down mid-form", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: /open note/i }));
    await user.type(noteField(), "Took 4oz, fussy after");

    // Whatever ends the page — re-auth navigation, iOS evicting the PWA —
    // there's no chance to react to it.
    unmount();

    render(<Harness />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /open note/i }));

    await waitFor(() => expect(noteField()).toHaveValue("Took 4oz, fussy after"));
  });

  it("discards the draft once the entry is saved", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: /open note/i }));
    await user.type(noteField(), "Slept through");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(loadDraft("note", 1)).toBeNull();

    await user.click(screen.getByRole("button", { name: /open note/i }));
    expect(noteField()).toHaveValue("");
  });

  it("discards the draft when the form is dismissed", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: /open note/i }));
    await user.type(noteField(), "never mind");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(loadDraft("note", 1)).toBeNull();

    await user.click(screen.getByRole("button", { name: /open note/i }));
    expect(noteField()).toHaveValue("");
  });

  it("stores nothing for a form that was only opened", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: /open note/i }));
    await screen.findByRole("dialog");

    expect(loadDraft("note", 1)).toBeNull();
  });

  it("keeps drafts separate per child", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: /open note/i }));
    await user.type(noteField(), "Mikey's note");
    await waitFor(() => expect(loadDraft("note", 1)).not.toBeNull());

    expect(loadDraft("note", 2)).toBeNull();
  });
});

describe("draft storage", () => {
  it("drops a draft that has gone stale", () => {
    saveDraft("note", 1, { content: "yesterday" });
    const stored = JSON.parse(localStorage.getItem("babytracker.draft.note.1")!);
    localStorage.setItem(
      "babytracker.draft.note.1",
      JSON.stringify({ ...stored, savedAt: Date.now() - DRAFT_TTL_MS - 1 })
    );

    expect(loadDraft("note", 1)).toBeNull();
    expect(localStorage.getItem("babytracker.draft.note.1")).toBeNull();
  });

  it("ignores a corrupt draft instead of breaking the form", () => {
    localStorage.setItem("babytracker.draft.note.1", "{not json");

    expect(loadDraft("note", 1)).toBeNull();
    expect(localStorage.getItem("babytracker.draft.note.1")).toBeNull();
  });

  it("survives storage being unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveDraft("note", 1, { content: "x" })).not.toThrow();

    setItem.mockRestore();
  });
});
