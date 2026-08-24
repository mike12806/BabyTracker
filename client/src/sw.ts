/// <reference lib="webworker" />

/**
 * The app's service worker.
 *
 * Hand-written (`injectManifest`) so the caching policy is explicit code
 * rather than plugin config, because the policy is the point:
 *
 *   API data is never cached. Not network-first, not as an offline fallback —
 *   never.
 *
 * The app is read as the current state of a baby — how long since the last
 * feed, whether she's been changed — so a saved copy of that data presented
 * later is worse than no data: it reads as a fact and it's false. Every
 * scheme that kept an offline copy needed a second mechanism to label it
 * (clock-skew inference, then an `X-From-Cache` header), and each of those
 * had windows where old data slipped through as current. Keeping no copy is
 * the only version with nothing to get wrong. When the server is unreachable
 * the app keeps whatever it last rendered, puts up a banner saying it can't
 * refresh, and retries — see `useDataRefresh` and `freshness.ts`.
 *
 * Priorities, in order: never show stale data, then cost, then performance.
 * Offline readability was the price; it was only ever readable-but-wrong.
 *
 * What *is* cached: the precached app shell (versioned per build, so never
 * stale in the data sense) and Google Fonts (immutable).
 */

import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// A new build should take over as soon as it is ready. The page decides *when*
// to reload for it — see `createDeferredReload`, which holds the reload until
// it can't cost the user a half-filled form.
self.skipWaiting();
clientsClaim();

// Previous builds kept day-old API replies in `api-cache` as an offline
// fallback. Deleting it here, not just no longer writing it, matters: a
// leftover copy would otherwise sit on every installed device waiting for a
// future bug to serve it. `cleanupOutdatedCaches` only covers the precache.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("api-cache"));
});

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

// No route matches /api/* — deliberately. Those requests pass straight
// through to the network and fail honestly when it's down.

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

// Diaper/feeding reminders — see server/src/scheduled/reminders.ts, which is
// the only thing that ever sends a push to this app. The payload is always
// fresh at the moment it's pushed (the server decides "overdue" right before
// sending), so unlike API data there's nothing here that can go stale by
// being shown.
self.addEventListener("push", (event) => {
  const data: { title?: string; body?: string; url?: string } = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Baby Tracker", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow((event.notification.data as { url?: string })?.url ?? "/"));
});
