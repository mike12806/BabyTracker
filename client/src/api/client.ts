import { markOffline, noteResponse } from "./freshness";
import { FROM_CACHE_HEADER } from "../serviceWorkerContract";

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

/**
 * How long to wait for a reply before giving up on a request (ms).
 *
 * Without this a request has no failure mode at all on a phone: a radio that
 * has dropped the connection without telling anyone leaves `fetch` pending
 * indefinitely, so it never throws, `markOffline` never runs, and the banner
 * and its retry loop — the whole apparatus for saying "this data is old" —
 * never arm. The screen just sits there looking current. A request that has
 * gone this long is not going to be answered, and calling it failed is what
 * puts the app back on a path that recovers.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * The same, for the two probes below (ms).
 *
 * Shorter because nothing is waiting on their answer: they only decide whether
 * to re-auth or when to retry, and both have another tick coming.
 */
export const PROBE_TIMEOUT_MS = 6_000;

/**
 * Is this status the API's own JWT check failing, or something upstream of
 * it doing the same job?
 *
 * Our Worker never returns 403 — every auth rejection it makes is a 401 (see
 * `server/src/middleware/auth.ts`). Cloudflare Access does return 403,
 * though, and for exactly the equivalent reason: for a page navigation an
 * expired session gets redirected to the login flow, but for a `fetch`/XHR
 * request — which is everything this client sends — Access answers 403
 * directly instead. So a 403 from this API can only be Access rejecting a
 * dead session at the edge before the request ever reached the Worker, and
 * belongs in the same bucket as our own 401: re-authenticate, don't report it
 * as a request failure.
 */
function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

function triggerReauth(): void {
  // Navigate (don't reload) to an /api/* URL: the service worker serves
  // cached HTML for normal navigations, so a reload never reaches Cloudflare
  // Access and the login flow can't run — this is what left the installed
  // PWA spinning forever once its session expired. Guard prevents a loop.
  const key = "auth_reload_ts";
  const last = sessionStorage.getItem(key);
  if (!last || Date.now() - Number(last) > 10_000) {
    sessionStorage.setItem(key, String(Date.now()));
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `${API_BASE}/auth/login?redirect=${redirect}`;
  }
}

/**
 * Can an authenticated request still reach the API?
 *
 * Used to tell an expired Access session apart from a dropped connection when
 * fetch() throws. The cache-busting param matters: the service worker answers
 * /api/ GETs network-first and would otherwise hand back a cached 200 from
 * before the session expired.
 */
async function sessionIsAlive(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  try {
    const res = await fetch(`${API_BASE}/auth/me?probe=${Date.now()}`, {
      credentials: "include",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * One cheap request answering "can the server be reached right now?".
 *
 * Used by the stale-data retry loop instead of a full refresh: while the
 * network is down, refreshing means every mounted page refetching, failing,
 * and toasting an error — a dozen doomed requests and an error popup every
 * cycle. Pinging first costs one request, and the full refresh only runs once
 * it will actually succeed.
 *
 * The cache-busting param keeps it honest across the upgrade from builds
 * whose worker still holds an `api-cache`: a unique URL can never be answered
 * from a cache, so an `ok` here is proof of a live server, not a stale copy.
 */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/me?probe=${Date.now()}`, {
      credentials: "include",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // An expired session (401 from our Worker, or 403 from Access rejecting
    // it before that) isn't a reachability problem — it needs re-auth, not an
    // endless "can't refresh" retry. Left unhandled, this ping would report
    // "unreachable" forever and the stale-data retry loop would poll every
    // 15s without ever sending the user back to log in.
    if (isAuthFailure(res.status)) {
      triggerReauth();
      return false;
    }
    return res.ok && res.headers?.get(FROM_CACHE_HEADER) !== "1";
  } catch {
    return false;
  }
}

async function doFetch(path: string, options: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // fetch() throws for two very different reasons: Cloudflare Access
    // redirecting an unauthenticated request to its login domain (surfaced as
    // a CORS error), and an ordinary dropped connection — routine on a phone.
    // Re-authing navigates away from whatever is on screen, so only do it once
    // we know the session is actually gone. Retrying the original request
    // isn't an option: a POST that failed on the way back would double-log.
    // Either way the data on screen just failed to refresh. With no offline
    // cache, a thrown fetch is the main way staleness begins, and this is the
    // only place that sees it — flag it before deciding what to do next.
    markOffline();
    if (await sessionIsAlive()) {
      throw new Error("Network error — check your connection and try again.");
    }
    triggerReauth();
    throw new Error("Unauthorized");
  }

  // Deliberately outside the try above: that catch means "the network failed",
  // and anything thrown in here would be misread as a dropped connection and
  // bounce the user through re-auth. A reply that arrives proves the server is
  // reachable again — `noteResponse` clears the staleness banner (and still
  // spots the cached replies a previous build's worker can serve during the
  // one load it takes to upgrade).
  //
  // Except when the server answers but cannot serve: a 5xx carries no data, so
  // the screen still shows whatever the last working refresh left there. Taking
  // it as proof of freshness cleared the banner off a reply that refreshed
  // nothing. Anything below 500 does prove the app can talk to the server —
  // including the 401 that starts re-auth and the 400 a rejected form gets —
  // and a refresh behind it will land.
  if (res.status >= 500) markOffline();
  else noteResponse(res);
  return res;
}

/**
 * The best sentence available for a failed response.
 *
 * The API sends `{ error }` for everything it rejects itself, but a request
 * can also die before reaching it — Cloudflare answers an oversized upload
 * with an HTML 413, and a gateway hiccup with an HTML 5xx. Parsing those as
 * JSON fails, and the old fallback ("Request failed") told the user nothing
 * about what to do next.
 */
async function errorFromResponse(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  const message = (body as { error?: string } | null)?.error;
  if (message) return new Error(message);

  if (res.status === 413) return new Error("That file is too large to upload.");
  if (res.status === 429) return new Error("Too many requests — wait a moment and try again.");
  if (res.status >= 500) return new Error(`The server had a problem (HTTP ${res.status}). Please try again.`);
  return new Error(`Request failed (HTTP ${res.status})`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await doFetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (isAuthFailure(res.status)) {
    triggerReauth();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    throw await errorFromResponse(res);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),

  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data) }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await doFetch(path, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (isAuthFailure(res.status)) {
      triggerReauth();
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      throw await errorFromResponse(res);
    }

    return res.json() as Promise<T>;
  },
};
