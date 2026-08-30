import { useEffect } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/api/client", () => ({
  pingServer: vi.fn(async () => true),
  api: { get: vi.fn(), getOptional: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  API_BASE: "/api",
}));

// An empty queue throughout: this file is about the socket, and the outbox has
// its own tests. Only what `DataRefreshProvider` actually reaches for.
//
// The snapshot must be the *same* array every call — `useOutbox` reads it
// through `useSyncExternalStore`, which re-renders whenever the reference
// changes and so spins forever on a factory that returns a fresh `[]`.
const EMPTY_OUTBOX: never[] = [];
vi.mock("../src/api/outbox", () => ({
  flushOutbox: vi.fn(async () => ({ synced: 0, failed: 0 })),
  getOutboxSnapshot: () => EMPTY_OUTBOX,
  subscribeOutbox: () => () => {},
}));

import {
  DataRefreshProvider,
  useDataRefresh,
  FOREGROUND_POLL_MS,
  LIVE_BACKSTOP_POLL_MS,
  LIVE_COALESCE_MS,
  LIVE_HELD_RECHECK_MS,
  REFRESH_THROTTLE_MS,
} from "../src/hooks/useDataRefresh";
import { connectLive, resetLive } from "../src/api/live";

/** The same stand-in as live.test.ts — see the note there. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  greet() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "ready", at: Date.now() }) });
  }
  publish(kind = "entries") {
    this.onmessage?.({ data: JSON.stringify({ type: "change", kind, at: Date.now() }) });
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

/** Counts how many times the app was told to refetch. */
let refreshes: number[];

function Probe() {
  const { refreshKey } = useDataRefresh();
  useEffect(() => {
    refreshes.push(refreshKey);
  }, [refreshKey]);
  return null;
}

/** Refetches triggered since mount — the mount's own render does not count. */
const refreshCount = () => refreshes.length - 1;

function mount() {
  return render(
    <DataRefreshProvider>
      <Probe />
    </DataRefreshProvider>,
  );
}

describe("live updates drive the refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    resetLive();
    refreshes = [];
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    resetLive();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function openSocket() {
    act(() => {
      connectLive(1);
      latest().greet();
    });
  }

  it("refetches when the server says something changed", () => {
    mount();
    openSocket();
    expect(refreshCount()).toBe(0);

    act(() => {
      latest().publish();
      vi.advanceTimersByTime(LIVE_COALESCE_MS + 1);
    });

    expect(refreshCount()).toBe(1);
  });

  it("collapses a burst of changes into one refetch", () => {
    // Someone logging a feed, a diaper and a note in quick succession should
    // cost one refetch, not three.
    mount();
    openSocket();

    act(() => {
      latest().publish("entries");
      latest().publish("entries");
      latest().publish("todos");
      vi.advanceTimersByTime(LIVE_COALESCE_MS + 1);
    });

    expect(refreshCount()).toBe(1);
  });

  it("does not let the resume throttle swallow a second change", () => {
    // The important one. `REFRESH_THROTTLE_MS` exists to suppress duplicate
    // refreshes of data nobody touched; a nudge is the server stating that
    // something *was* touched. Routing nudges through that throttle would
    // silently drop the second of two entries logged seconds apart — exactly
    // what this feature is for.
    mount();
    openSocket();

    act(() => {
      latest().publish();
      vi.advanceTimersByTime(LIVE_COALESCE_MS + 1);
    });
    expect(refreshCount()).toBe(1);

    act(() => {
      // Well inside the throttle window, which would have discarded this.
      vi.advanceTimersByTime(REFRESH_THROTTLE_MS / 4);
      latest().publish();
      vi.advanceTimersByTime(LIVE_COALESCE_MS + 1);
    });

    expect(refreshCount()).toBe(2);
  });

  it("polls slowly while the socket is delivering", () => {
    // Slowly, not never. A socket that has quietly stopped delivering looks
    // exactly like a household where nobody has logged anything.
    mount();
    openSocket();

    act(() => {
      vi.advanceTimersByTime(FOREGROUND_POLL_MS * 2);
    });
    expect(refreshCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(LIVE_BACKSTOP_POLL_MS);
    });
    expect(refreshCount()).toBe(1);
  });

  it("polls at the old rate when there is no socket", () => {
    mount();

    act(() => {
      vi.advanceTimersByTime(FOREGROUND_POLL_MS + 1);
    });

    expect(refreshCount()).toBe(1);
  });

  it("goes back to the fast poll when the socket drops", () => {
    mount();
    openSocket();

    act(() => {
      latest().close();
    });

    act(() => {
      vi.advanceTimersByTime(FOREGROUND_POLL_MS + 1);
    });

    expect(refreshCount()).toBeGreaterThanOrEqual(1);
  });

  it("holds a change back while a form is open", () => {
    // Nothing rebuilds under a half-filled dialog — the same rule every other
    // refresh trigger in this file follows.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    mount();
    openSocket();

    act(() => {
      latest().publish();
      vi.advanceTimersByTime(LIVE_COALESCE_MS + 1);
    });
    expect(refreshCount()).toBe(0);

    // Closing the form releases it. `focusout` is the responsive path; this is
    // the case where it never fires — a dialog dismissed by tapping the
    // backdrop — so the held nudge has to release itself.
    dialog.remove();
    act(() => {
      vi.advanceTimersByTime(LIVE_HELD_RECHECK_MS + 1);
    });
    expect(refreshCount()).toBe(1);
  });

  it("refetches after an outage long enough to have missed something", () => {
    mount();
    openSocket();

    act(() => {
      latest().close();
      // A change published in here reached nobody and is never re-sent.
      vi.advanceTimersByTime(REFRESH_THROTTLE_MS * 3);
    });

    const before = refreshCount();
    act(() => {
      latest().greet();
    });

    expect(refreshCount()).toBeGreaterThan(before);
  });

  it("does not refetch on the first connection of a session", () => {
    // The pages have only just mounted and fetched; there is no gap to cover.
    mount();
    openSocket();
    expect(refreshCount()).toBe(0);
  });
});
