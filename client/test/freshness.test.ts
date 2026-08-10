import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStaleSince,
  markOffline,
  noteLiveResponse,
  noteResponse,
  resetFreshness,
} from "../src/api/freshness";
import { FROM_CACHE_HEADER } from "../src/serviceWorkerContract";

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

describe("replies the service worker labels as cache hits", () => {
  /** A reply as the service worker hands one back from its offline cache. */
  function cachedReply(servedAt: Date | null): Response {
    const headers = new Headers(servedAt ? { date: servedAt.toUTCString() } : {});
    headers.set(FROM_CACHE_HEADER, "1");
    return { headers } as Response;
  }

  it("is flagged on the very first reply of a session", () => {
    // The case the clock reasoning cannot get right on its own: nothing has
    // been seen yet, so there is no estimate to measure this against. The
    // label settles it regardless.
    noteResponse(cachedReply(new Date(NOW.getTime() - 30 * 60000)));

    expect(getStaleSince()).toBe(NOW.getTime() - 30 * 60000);
  });

  it("is flagged even when the device believes it is online", () => {
    setOnline(true);
    noteResponse(cachedReply(new Date(NOW.getTime() - 45 * 60000)));

    expect(getStaleSince()).not.toBeNull();
  });

  it("is flagged even when the reply carries no usable Date", () => {
    noteResponse(cachedReply(null));

    expect(getStaleSince()).not.toBeNull();
  });

  it("cannot be talked back into looking live by a later cache hit", () => {
    noteResponse(response(NOW));
    expect(getStaleSince()).toBeNull();

    noteResponse(cachedReply(new Date(NOW.getTime() - 10 * 60000)));
    expect(getStaleSince()).not.toBeNull();
  });

  it("clears once a genuinely live reply arrives", () => {
    noteResponse(cachedReply(new Date(NOW.getTime() - 30 * 60000)));
    expect(getStaleSince()).not.toBeNull();

    noteResponse(response(NOW));
    expect(getStaleSince()).toBeNull();
  });

  it("refuses to calibrate the probe against one", () => {
    // The probe's URL is unique so this should be unreachable, but calibrating
    // from a cached reply is precisely the bug the probe exists to correct.
    expect(noteLiveResponse(cachedReply(NOW))).toBe(false);
    expect(getStaleSince()).not.toBeNull();
  });
});

describe("the cold-start blind spot", () => {
  it("cannot tell a cached first reply from a live one on its own", () => {
    // Documents *why* `noteLiveResponse` exists rather than asserting good
    // behaviour: with nothing to calibrate against, the first reply of the
    // session defines the skew, so its own age vanishes into that estimate.
    // The device is online as far as the browser is concerned — a phone whose
    // radio has not finished reconnecting reports exactly this.
    noteResponse(response(new Date(NOW.getTime() - 30 * 60000)));

    expect(getStaleSince()).toBeNull();
  });

  it("spots that earlier replies came from the cache once a live one lands", () => {
    noteResponse(response(new Date(NOW.getTime() - 30 * 60000)));

    // A reply from a URL the cache cannot hold, so this one is live by
    // construction and its Date is a true reading of the server clock.
    expect(noteLiveResponse(response(NOW))).toBe(true);
  });

  it("does not claim a miscalibration on an ordinary healthy start", () => {
    noteResponse(response(NOW));

    expect(noteLiveResponse(response(NOW))).toBe(false);
    expect(getStaleSince()).toBeNull();
  });

  it("leaves a wrong device clock alone rather than reading it as cached data", () => {
    // Phone 20 minutes fast, connection fine. The probe agrees with the reply
    // that calibrated the skew, so there is nothing to correct.
    const serverNow = new Date(NOW.getTime() - 20 * 60000);
    noteResponse(response(serverNow));

    expect(noteLiveResponse(response(serverNow))).toBe(false);
    expect(getStaleSince()).toBeNull();
  });

  it("flags the app as offline when the probe cannot get through at all", () => {
    // A request that throws never reaches `noteResponse`, so without this the
    // app would sit on cached data with nothing marking it.
    markOffline();

    expect(getStaleSince()).toBe(NOW.getTime());
  });

  it("keeps the original stale timestamp when the probe fails twice", () => {
    markOffline();
    vi.setSystemTime(new Date(NOW.getTime() + 60000));
    markOffline();

    expect(getStaleSince()).toBe(NOW.getTime());
  });
});
