/// <reference lib="webworker" />

/**
 * The app's service worker.
 *
 * This is a hand-written worker (`injectManifest`) rather than one generated
 * from config, for one reason: a reply the worker serves from its offline
 * cache has to be *labelled* as such.
 *
 * The app is read as the current state of a baby — how long since the last
 * feed, whether she's been changed — so cached entries presented as live are a
 * correctness bug. The client used to infer which was which by comparing each
 * reply's `Date` against an estimate of the server clock, which is guesswork
 * that fails outright on a cold start: the first reply of a session is the
 * only sample there is, so if it came from the cache its age disappears into
 * the estimate and half-hour-old entries read as current.
 *
 * The worker doesn't have to guess — it knows. `markCacheHits` stamps every
 * cache-served reply with `X-From-Cache`, turning the client's inference into
 * a fact it can just read.
 */

import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import type { WorkboxPlugin } from "workbox-core/types";
import { FROM_CACHE_HEADER } from "./serviceWorkerContract";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/**
 * Stamps `X-From-Cache` on anything answered out of the cache.
 *
 * A `Response`'s headers are immutable once constructed, so the reply has to
 * be rebuilt around a copied header set. That costs a body read, which is why
 * this is attached only to the API route and not to precached assets — nobody
 * needs to know whether a stylesheet came from cache.
 */
const markCacheHits: WorkboxPlugin = {
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return cachedResponse;

    const headers = new Headers(cachedResponse.headers);
    headers.set(FROM_CACHE_HEADER, "1");

    return new Response(await cachedResponse.blob(), {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers,
    });
  },
};

// A new build should take over as soon as it is ready. The page decides *when*
// to reload for it — see `createDeferredReload`, which holds the reload until
// it can't cost the user a half-filled form.
self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Navigations are served the precached shell, except where the request has to
// reach the edge: /api/auth/login runs Cloudflare Access's redirect flow, and
// /cdn-cgi/ is its callback — answering either with cached HTML means the auth
// cookie is never set and the installed app spins forever.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/cdn-cgi\//],
  })
);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" && request.mode !== "navigate" && url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "api-cache",
    // Deliberately no `networkTimeoutSeconds`. It used to be 5s, which meant a
    // merely slow connection — the normal case on a phone in a nursery —
    // silently abandoned a request that was about to succeed and answered from
    // cache instead. Without it the cache is only consulted when the network
    // genuinely fails, so a live network always wins.
    plugins: [
      markCacheHits,
      // 200 only: an opaque (status 0) reply here would be the Cloudflare
      // Access login redirect, which is not data.
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 60,
        // Only reachable while offline, and a day-old reading labelled as
        // stale beats an empty screen.
        maxAgeSeconds: 60 * 60 * 24,
      }),
    ],
  })
);

registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({
    cacheName: "google-fonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);
