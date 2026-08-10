/**
 * Tracks whether the data on screen actually came from the server.
 *
 * The service worker answers `/api/` GETs network-first and falls back to its
 * cache when the network fails, which is what keeps the installed app usable
 * on a bad signal. The cost is that a cached reply is indistinguishable from a
 * live one: the app renders "last feeding 20m ago" with the same confidence
 * whether that was read from D1 a second ago or from cache at breakfast. This
 * module spots the cached replies so the UI can say so.
 *
 * The service worker labels those replies outright (`FROM_CACHE_HEADER`), so
 * that is what this reads first. The clock reasoning below it is the fallback
 * for the cases the label doesn't cover: a browser running no service worker,
 * and the first load after an upgrade, where the previous worker is still the
 * one answering and doesn't set it.
 */

import { FROM_CACHE_HEADER } from "../serviceWorkerContract";

/** Treat data as stale once it is this far behind the server clock (ms). */
const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Best estimate of `serverClock - localClock` (ms).
 *
 * A phone whose clock is minutes off would otherwise make every fresh reply
 * look ancient, so ages are measured against the server's own clock rather
 * than the device's. A reply is always generated *before* it arrives, so
 * `Date - now` for any single response is at most the true skew — the largest
 * sample seen is therefore the best estimate, and one taken from a cached
 * reply only ever drags it down. That biases us toward calling stale data
 * fresh, never the reverse, which is the safe direction for a false alarm.
 */
let clockSkewMs: number | null = null;

/** When the data being shown was generated (local ms), or null if it's fresh. */
let staleSince: number | null = null;

const listeners = new Set<() => void>();

function setStaleSince(value: number | null): void {
  if (staleSince === value) return;
  staleSince = value;
  for (const listener of listeners) listener();
}

/**
 * Record a successful response and update the staleness flag.
 *
 * Mutations are worth passing in too: the service worker only ever caches
 * GETs, so a POST that comes back at all proves the network is reachable.
 */
export function noteResponse(res: Response): void {
  // `navigator.onLine === false` is only ever reported when the device truly
  // has no connection, so a request that still succeeded was served from
  // cache. This is the one signal that works on a cold start with no fresh
  // response to calibrate against — an app opened offline.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  // Headers are optional-chained rather than assumed: this sits on the path of
  // every single request, and it exists only to label the UI — it must never
  // be the reason a response fails to come back.
  const header = res.headers?.get("date");
  const servedAt = header ? Date.parse(header) : NaN;

  // Where the label is present there is nothing to work out: everything below
  // is an attempt to infer what it states outright. Kept ahead of the clock
  // reasoning so a cache hit can never be talked into looking live — that is
  // what made a cold start on a phone whose radio hadn't reconnected show
  // half-hour-old entries as current.
  if (res.headers?.get(FROM_CACHE_HEADER) === "1") {
    const generatedAt = Number.isNaN(servedAt) ? Date.now() : servedAt - (clockSkewMs ?? 0);
    setStaleSince(Math.min(generatedAt, staleSince ?? generatedAt));
    return;
  }
  if (Number.isNaN(servedAt)) {
    // No usable `Date` (a dev server, or a mocked response in tests): fall
    // back to the connectivity signal alone rather than guessing at an age.
    if (offline) setStaleSince(staleSince ?? Date.now());
    else setStaleSince(null);
    return;
  }

  const now = Date.now();
  const sample = servedAt - now;
  if (clockSkewMs === null || sample > clockSkewMs) clockSkewMs = sample;

  const generatedAt = servedAt - clockSkewMs; // in local-clock terms
  const age = now - generatedAt;

  if (age < STALE_AFTER_MS && !offline) {
    setStaleSince(null);
    return;
  }
  // Several endpoints load in parallel; report the oldest thing on screen.
  setStaleSince(Math.min(generatedAt, staleSince ?? generatedAt));
}

/**
 * Calibrate the skew from a reply that cannot have come from the cache, and
 * report whether anything already noted this session was misjudged because of
 * it.
 *
 * The estimate above is only sound once it has seen a live reply. On a cold
 * start it has not: the first reply of the session sets the skew outright, so
 * if that reply came from the offline cache — an installed PWA launched before
 * the phone's radio is back is the everyday case — the skew absorbs its whole
 * age and `noteResponse` pronounces half-hour-old entries fresh. There is no
 * way to tell a cached reply from a live one after the fact, so this takes the
 * one measurement that is unambiguous by construction: the caller fetches a
 * URL the cache cannot hold (see `probeLiveness`).
 *
 * Returns true when the corrected skew is enough higher than what earlier
 * replies were judged against that those replies must have been cache hits
 * reported as live — the caller's cue to refetch.
 */
export function noteLiveResponse(res: Response): boolean {
  // Defensive: the probe's URL is unique per call so no cache can hold it, but
  // if one somehow answered we must not calibrate against it — that is the
  // exact mistake this function exists to correct.
  if (res.headers?.get(FROM_CACHE_HEADER) === "1") {
    markOffline();
    return false;
  }

  const header = res.headers?.get("date");
  const servedAt = header ? Date.parse(header) : NaN;
  if (Number.isNaN(servedAt)) {
    setStaleSince(null);
    return false;
  }

  const sample = servedAt - Date.now();
  const previous = clockSkewMs;
  const corrected = previous === null || sample > previous ? sample : previous;
  clockSkewMs = corrected;

  const misjudged = previous !== null && corrected - previous >= STALE_AFTER_MS;
  // This reply is live, so whatever it says is current by definition.
  setStaleSince(null);
  return misjudged;
}

/**
 * Record that the API could not be reached, so the app is running on whatever
 * the service worker had. Used when the liveness probe itself fails, which is
 * the one case `noteResponse` never sees — a request that throws never reaches
 * it.
 */
export function markOffline(): void {
  setStaleSince(staleSince ?? Date.now());
}

/** Subscribe to staleness changes. Returns an unsubscribe function. */
export function subscribeFreshness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** When the data on screen was generated (local ms), or null if it's fresh. */
export function getStaleSince(): number | null {
  return staleSince;
}

/** Test seam — drops the calibrated skew and any recorded staleness. */
export function resetFreshness(): void {
  clockSkewMs = null;
  staleSince = null;
  for (const listener of listeners) listener();
}
