/**
 * The alerts bell.
 *
 * What matters here is the badge telling the truth: it counts what the server
 * says is unread, it clears only as far as what was actually rendered, and it
 * refuses to clear at all when the server didn't record the read.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Alert } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    getOptional: vi.fn(),
    post: vi.fn(),
    postOptional: vi.fn(),
    postSlow: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/usePushNotifications", () => ({
  usePushNotifications: vi.fn(() => ({
    supported: false,
    permission: "unsupported",
    subscribed: false,
    working: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  })),
}));

import AlertsBell from "../src/components/AlertsBell";
import { DataRefreshProvider, useDataRefresh } from "../src/hooks/useDataRefresh";
import { api } from "../src/api/client";
import { usePushNotifications } from "../src/hooks/usePushNotifications";

const mockApi = vi.mocked(api);
const theme = createTheme();

function alert(id: number, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    child_id: 1,
    kind: "diaper",
    title: "Diaper reminder",
    body: `Alert ${id}`,
    url: "/",
    created_at: "2026-08-20T10:00:00Z",
    child_first_name: "Nolan",
    ...overrides,
  };
}

/** The feed the bell will be handed on its next fetch. */
function feed(alerts: Alert[], unread: number, lastReadAt: string | null = null) {
  mockApi.getOptional.mockResolvedValue({ alerts, unread, last_read_at: lastReadAt });
}

/** Renders the bell with a button that bumps `refreshKey`, as a save would. */
function Harness() {
  const { refreshData } = useDataRefresh();
  return (
    <>
      <AlertsBell />
      <button onClick={refreshData}>refresh</button>
    </>
  );
}

function renderBell() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DataRefreshProvider>
          <Harness />
        </DataRefreshProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.postOptional.mockResolvedValue({ last_read_at: "2026-08-20T10:00:00Z" });
});

describe("AlertsBell", () => {
  it("shows the unread count from the server", async () => {
    feed([alert(1), alert(2)], 2);
    renderBell();

    expect(await screen.findByLabelText("Alerts (2 new)")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("lists the alerts as the server sent them", async () => {
    feed(
      [
        alert(1, { body: "No diaper change logged for Nolan in over 2 hours 45 minutes." }),
        alert(2, { kind: "feeding_trend", title: "Feeding trend", body: "Nolan has had 2 feeds by 11am." }),
      ],
      1,
    );
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts (1 new)"));

    expect(
      await screen.findByText("No diaper change logged for Nolan in over 2 hours 45 minutes."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nolan has had 2 feeds by 11am.")).toBeInTheDocument();
  });

  it("marks read only as far as the newest alert on screen, and clears the badge", async () => {
    feed([alert(2, { created_at: "2026-08-20T12:00:00Z" }), alert(1)], 2);
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts (2 new)"));

    // The newest rendered row's timestamp, never "now" — an alert raised
    // between the fetch and this call has to stay unread.
    await waitFor(() =>
      expect(mockApi.postOptional).toHaveBeenCalledWith("/alerts/read", { up_to: "2026-08-20T12:00:00Z" }),
    );
    expect(await screen.findByLabelText("Alerts")).toBeInTheDocument();
  });

  it("keeps the badge when the server never recorded the read", async () => {
    feed([alert(1)], 1);
    mockApi.postOptional.mockRejectedValue(new Error("Network error"));
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts (1 new)"));

    await waitFor(() => expect(mockApi.postOptional).toHaveBeenCalled());
    // Still 1: a badge cleared locally against a server that didn't record it
    // would come back on the next load anyway, having hidden the alert in between.
    expect(screen.getByLabelText("Alerts (1 new)")).toBeInTheDocument();
  });

  it("marks the ones that arrived since the last visit, and not the older ones", async () => {
    feed(
      [
        alert(2, { body: "Arrived since", created_at: "2026-08-20T12:00:00Z" }),
        alert(1, { body: "Read last time", created_at: "2026-08-19T09:00:00Z" }),
      ],
      1,
      "2026-08-20T08:00:00Z",
    );
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts (1 new)"));

    await screen.findByText("Arrived since");
    // One "New" marker, on the row that postdates the read mark.
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("does not mark anything read when there is nothing unread", async () => {
    feed([alert(1)], 0, "2026-08-21T10:00:00Z");
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts"));

    await screen.findByText("Alert 1");
    expect(mockApi.postOptional).not.toHaveBeenCalled();
  });

  it("says so, rather than claiming a count, when the feed can't be loaded", async () => {
    mockApi.getOptional.mockRejectedValue(new Error("Network error"));
    renderBell();

    const bell = await screen.findByLabelText("Alerts");
    await userEvent.click(bell);

    expect(await screen.findByText("Couldn't load alerts just now.")).toBeInTheDocument();
    // No badge: the bell doesn't stand behind a number it couldn't fetch.
    expect(screen.queryByLabelText(/Alerts \(/)).not.toBeInTheDocument();
  });

  it("refetches with the rest of the app", async () => {
    feed([alert(1)], 1);
    renderBell();
    await screen.findByLabelText("Alerts (1 new)");

    // A save (or the foreground poll, or coming back to the app) bumps
    // `refreshKey`; a bell that only loaded once would still say 1.
    feed([alert(1), alert(2)], 2);
    await userEvent.click(screen.getByText("refresh"));

    expect(await screen.findByLabelText("Alerts (2 new)")).toBeInTheDocument();
  });

  it("offers to turn notifications on from the drawer when they are off", async () => {
    const subscribe = vi.fn(async () => {});
    vi.mocked(usePushNotifications).mockReturnValue({
      supported: true,
      permission: "default",
      subscribed: false,
      working: false,
      subscribe,
      unsubscribe: vi.fn(),
    });
    feed([alert(1)], 0, "2026-08-21T10:00:00Z");
    renderBell();

    await userEvent.click(await screen.findByLabelText("Alerts"));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(subscribe).toHaveBeenCalled();
  });
});
