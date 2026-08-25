import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child, DiaperChange } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => false),
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

import DiapersPage from "../src/pages/DiapersPage";
import PendingSyncBanner from "../src/components/PendingSyncBanner";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { NotificationProvider } from "../src/hooks/useNotification";
import { useChildren } from "../src/hooks/useChildren";
import { api } from "../src/api/client";
import { ApiError } from "../src/api/errors";
import { getOutboxSnapshot, resetOutbox } from "../src/api/outbox";

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

/** What `client.ts` throws when the request never got an answer. */
const dropped = () => new ApiError("Network error — check your connection and try again.");

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <NotificationProvider>
          <DataRefreshProvider>
            <PendingSyncBanner />
            <DiapersPage />
          </DataRefreshProvider>
        </NotificationProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Fill in the one required field and press Save. */
async function logADiaper(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Add Change" }));
  const time = await screen.findByLabelText(/^time/i);
  await user.clear(time);
  await user.type(time, "2026-08-25T14:05");
  await user.click(screen.getByRole("button", { name: /^save$/i }));
}

/**
 * Wait for the dialog to finish closing.
 *
 * MUI keeps the paper mounted through its close transition, and while it is
 * there the rest of the app sits under `aria-hidden` — so a `getByRole` query
 * for anything outside the dialog finds nothing until this settles.
 */
async function dialogClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

function fetchCount(): number {
  return mockApi.get.mock.calls.filter(([url]) => String(url).startsWith("/diaper-changes")).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOutbox();
  vi.mocked(useChildren).mockReturnValue({
    children: [child],
    selectedChild: child,
    selectChild: vi.fn(),
    refreshChildren: vi.fn(),
    loading: false,
  } as unknown as ReturnType<typeof useChildren>);
  mockApi.get.mockResolvedValue([]);
});

describe("logging while the server is unreachable", () => {
  it("keeps the entry on the device instead of losing what was typed", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();

    await logADiaper(user);

    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(1));
    expect(await screen.findByText(/it'll sync when the server is back/i)).toBeInTheDocument();
    // The dialog closes: the save is done as far as the user is concerned, and
    // leaving the form up would ask them to do something about it.
    await dialogClosed();
  });

  it("shows the queued entry in the log, marked as not synced", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();

    await logADiaper(user);

    // In the list, because "when was she last changed" is answered off this
    // screen and the answer is now this entry...
    const rows = await screen.findAllByText(/wet/i);
    expect(rows.length).toBeGreaterThan(0);
    // ...and marked, because nobody else's phone can see it yet.
    expect((await screen.findAllByLabelText("Not synced")).length).toBeGreaterThan(0);
  });

  it("says how many entries are waiting, and lists them on request", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();

    await logADiaper(user);

    const banner = await screen.findByText(/haven't reached the server yet/i);
    expect(banner).toBeInTheDocument();
    await dialogClosed();
    await user.click(screen.getByRole("button", { name: /^show$/i }));
    expect(await screen.findByText(/^Diaper change ·/)).toBeInTheDocument();
  });

  it("sends it with the same key once the server is back, so it cannot double-log", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();
    await logADiaper(user);
    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(1));
    await dialogClosed();
    const queuedBody = getOutboxSnapshot()[0].body;

    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue({ id: 9, ...queuedBody });
    await user.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(0));
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith("/diaper-changes", queuedBody);
    // The key it was queued with is the key it is sent with — that is the
    // whole reason a flush is safe to repeat.
    expect(queuedBody.client_request_id).toEqual(expect.any(String));
  });

  it("shows the synced entries even when the app was refreshed moments earlier", async () => {
    // Coming back to the app refreshes, and the same return flushes the queue
    // a beat later. The refresh throttle that stops the return itself
    // reloading twice must not swallow the flush's refetch with it, or the
    // entries that just reached the server keep their "not synced" mark until
    // the next poll — up to a minute of the app contradicting itself.
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();
    await logADiaper(user);
    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(1));
    await dialogClosed();

    // The app comes back while the server is still out of reach: the refresh
    // this fires is what arms the throttle, and the flush it also fires sends
    // nothing.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchCount()).toBeGreaterThanOrEqual(2));
    expect(getOutboxSnapshot()).toHaveLength(1);
    const afterReturn = fetchCount();

    // The radio finishes re-attaching a beat later, still inside the throttle
    // window, and this time the queue drains.
    const queuedBody = getOutboxSnapshot()[0].body;
    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue({ id: 9, ...queuedBody });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(0));
    await waitFor(() => expect(fetchCount()).toBeGreaterThan(afterReturn));
  });

  it("drops the pending row once the server's copy arrives, rather than showing both", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();
    await logADiaper(user);
    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(1));

    await dialogClosed();

    const saved: DiaperChange = {
      id: 9,
      child_id: 1,
      time: "2026-08-25T14:05:00.000Z",
      type: "wet",
      color: null,
      notes: null,
      created_at: "2026-08-25T16:30:00Z",
      updated_at: "2026-08-25T16:30:00Z",
    };
    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue(saved);
    mockApi.get.mockResolvedValue([saved]);
    await user.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => expect(screen.queryAllByLabelText("Not synced")).toHaveLength(0));
    expect(screen.queryByText(/haven't reached the server yet/i)).not.toBeInTheDocument();
  });

  it("does not queue an entry the server rejected — it needs fixing, not resending", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(new ApiError("type is required", 400));
    renderPage();

    await logADiaper(user);

    expect(await screen.findByText("type is required")).toBeInTheDocument();
    expect(getOutboxSnapshot()).toHaveLength(0);
    // The form stays up with everything still in it, so it can be corrected.
    expect(screen.getByRole("heading", { name: /add diaper change/i })).toBeInTheDocument();
  });

  it("discards a queued entry locally, with no server round trip to wait for", async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValue(dropped());
    renderPage();
    await logADiaper(user);
    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(1));

    await dialogClosed();
    await user.click(screen.getByRole("button", { name: /^show$/i }));
    const banner = screen.getByText(/haven't reached the server yet/i).closest(".MuiAlert-root")!;
    await user.click(within(banner as HTMLElement).getByRole("button", { name: /discard/i }));

    await waitFor(() => expect(getOutboxSnapshot()).toHaveLength(0));
    expect(mockApi.delete).not.toHaveBeenCalled();
  });
});
