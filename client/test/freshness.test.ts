import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStaleSince, noteResponse, resetFreshness } from "../src/api/freshness";

const NOW = new Date(2026, 2, 4, 12, 0, 0);

/** A response as the service worker or the network would hand one back. */
function response(servedAt: Date | null): Response {
  return {
    headers: new Headers(servedAt ? { date: servedAt.toUTCString() } : {}),
  } as Response;
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setOnline(true);
  resetFreshness();
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe("response freshness", () => {
  it("treats a reply generated just now as fresh", () => {
    noteResponse(response(NOW));
    expect(getStaleSince()).toBeNull();
  });

  it("flags a reply the service worker served from its offline cache", () => {
    // Calibrate on a live reply, then get one from cache — the network went
    // away and workbox answered with what it had from half an hour ago.
    noteResponse(response(NOW));
    const cached = new Date(NOW.getTime() - 30 * 60000);
    noteResponse(response(cached));

    expect(getStaleSince()).toBe(cached.getTime());
  });

  it("clears the flag as soon as a live reply comes back", () => {
    noteResponse(response(NOW));
    noteResponse(response(new Date(NOW.getTime() - 30 * 60000)));
    expect(getStaleSince()).not.toBeNull();

    noteResponse(response(NOW));
    expect(getStaleSince()).toBeNull();
  });

  it("does not cry stale on a device whose own clock is wrong", () => {
    // Phone clock running 20 minutes fast. Every reply the server generates
    // looks 20 minutes old by the local clock, which would otherwise put the
    // banner up permanently on a perfectly healthy connection.
    const serverNow = new Date(NOW.getTime() - 20 * 60000);
    noteResponse(response(serverNow));

    expect(getStaleSince()).toBeNull();
  });

  it("still spots genuinely old data on a device whose clock is wrong", () => {
    const skew = -20 * 60000;
    noteResponse(response(new Date(NOW.getTime() + skew)));

    const cached = new Date(NOW.getTime() + skew - 30 * 60000);
    noteResponse(response(cached));

    expect(getStaleSince()).toBe(cached.getTime() - skew);
  });

  it("flags an app opened with no connection, before any live reply calibrates the clock", () => {
    // Cold start in a basement: everything on screen came out of the cache and
    // there is no fresh reply to measure it against, so the clock reasoning
    // has nothing to work with. Being offline is the giveaway.
    setOnline(false);
    noteResponse(response(new Date(NOW.getTime() - 45 * 60000)));

    expect(getStaleSince()).not.toBeNull();
  });

  it("keeps quiet when a reply carries no Date header at all", () => {
    // The dev server doesn't always set one; guessing an age from nothing
    // would put a false banner in front of the user.
    noteResponse(response(null));
    expect(getStaleSince()).toBeNull();
  });

  it("reports the oldest thing on screen when several reads come back stale", () => {
    noteResponse(response(NOW));
    const older = new Date(NOW.getTime() - 50 * 60000);
    noteResponse(response(new Date(NOW.getTime() - 30 * 60000)));
    noteResponse(response(older));

    expect(getStaleSince()).toBe(older.getTime());
  });
});
