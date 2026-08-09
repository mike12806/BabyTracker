import type { MiddlewareHandler } from "hono";

/**
 * Marks API replies as uncacheable.
 *
 * Entries are logged from several devices at once, so a reply that is even a
 * few minutes old is misleading rather than merely dated. Nothing between the
 * Worker and the app — the browser's HTTP cache, Cloudflare's edge, a proxy in
 * between — may keep one and hand it back later.
 *
 * The app's own offline cache is unaffected: the Cache Storage API the service
 * worker writes through does not consult `Cache-Control`, so the installed PWA
 * keeps working with no signal, and labels what it serves from there as stale.
 *
 * A handler that sets its own policy wins — the child photo is served with
 * `private, max-age=3600` and cache-busted with the child's `updated_at`, so it
 * should stay cacheable.
 */
export const cacheControlMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) {
    c.header("Cache-Control", "no-store");
  }
};
