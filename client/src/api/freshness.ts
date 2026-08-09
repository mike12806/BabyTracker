/**
 * Tracks whether the data on screen actually came from the server.
 *
 * The service worker answers `/api/` GETs network-first and falls back to its
 * cache when the network fails, which is what keeps the installed app usable
 * on a bad signal. The cost is that a cached reply is indistinguishable from a
 * live one: the app renders "last feeding 20m ago" with the same confidence
 * whether that was read from D1 a second ago or from cache at breakfast. This
 * module spots the cached replies so the UI can say so.
 */

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
