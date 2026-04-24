import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePullToRefresh, PULL_THRESHOLD } from "../src/hooks/usePullToRefresh";

// jsdom does not implement the Touch API — provide a minimal polyfill
class MockTouch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  constructor(init: { identifier: number; target: EventTarget; clientX: number; clientY: number }) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
  }
}
if (typeof globalThis.Touch === "undefined") {
  (globalThis as Record<string, unknown>).Touch = MockTouch;
}

const reloadMock = vi.fn();

// jsdom doesn't allow spying on window.location.reload directly, so we replace the whole object
Object.defineProperty(window, "location", {
  configurable: true,
  value: { ...window.location, reload: reloadMock },
});

function fireTouchEvent(type: string, clientY: number, target: EventTarget = document) {
  const touch = new Touch({ identifier: 1, target, clientY, clientX: 0 });
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  // jsdom's TouchEvent doesn't populate touches from init options, so define them manually
  Object.defineProperty(event, "touches", {
    get: () => (type === "touchend" ? [] : [touch]),
  });
  Object.defineProperty(event, "changedTouches", {
    get: () => [touch],
  });
  // Dispatch from the actual target so e.target reflects it correctly (bubbles up to document)
  target.dispatchEvent(event);
  return event;
}

describe("usePullToRefresh", () => {
  beforeEach(() => {
    reloadMock.mockClear();
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns initial state with zero pull distance", () => {
    const { result } = renderHook(() => usePullToRefresh());
    expect(result.current.pullDistance).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.threshold).toBe(PULL_THRESHOLD);
  });

  it("updates pullDistance during a pull gesture", () => {
    const { result } = renderHook(() => usePullToRefresh());

    act(() => {
      fireTouchEvent("touchstart", 200);
      fireTouchEvent("touchmove", 250);
    });

    expect(result.current.pullDistance).toBe(50);
  });

  it("reloads the page when pulled past the threshold", () => {
    const { result } = renderHook(() => usePullToRefresh());

    act(() => {
      fireTouchEvent("touchstart", 100);
      fireTouchEvent("touchmove", 100 + PULL_THRESHOLD + 10);
      fireTouchEvent("touchend", 100 + PULL_THRESHOLD + 10);
    });

    expect(result.current.isRefreshing).toBe(true);
    expect(reloadMock).toHaveBeenCalled();
  });

  it("snaps back when pull is below threshold", () => {
    const { result } = renderHook(() => usePullToRefresh());

    act(() => {
      fireTouchEvent("touchstart", 100);
      fireTouchEvent("touchmove", 130); // 30px, below threshold
      fireTouchEvent("touchend", 130);
    });

    expect(result.current.pullDistance).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not activate when page is scrolled down", () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(100);
    const { result } = renderHook(() => usePullToRefresh());

    act(() => {
      fireTouchEvent("touchstart", 100);
      fireTouchEvent("touchmove", 200);
      fireTouchEvent("touchend", 200);
    });

    expect(result.current.pullDistance).toBe(0);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not trigger when touch starts inside a dialog", () => {
    const { result } = renderHook(() => usePullToRefresh());

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    act(() => {
      fireTouchEvent("touchstart", 100, dialog);
      fireTouchEvent("touchmove", 100 + PULL_THRESHOLD + 10);
      fireTouchEvent("touchend", 100 + PULL_THRESHOLD + 10);
    });

    document.body.removeChild(dialog);

    expect(result.current.pullDistance).toBe(0);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
