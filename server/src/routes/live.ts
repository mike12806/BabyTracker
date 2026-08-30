import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { liveRoomName } from "../live.js";
import { verifyChildExists } from "./crud.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

export const live = new Hono<AppEnv>();

/**
 * Open a live-update socket for one child.
 *
 * `GET /api/live?child_id=3&client=<opaque id>`, upgraded to a WebSocket and
 * handed to that child's Durable Object. See `src/live.ts` for what comes back
 * over it (nudges, never data) and why a DO is doing the holding.
 *
 * Authentication is `authMiddleware`, unchanged and unaware this is a socket.
 * A browser cannot set headers on `new WebSocket()`, but it does send cookies
 * on a same-origin handshake and Cloudflare Access injects
 * `Cf-Access-Jwt-Assertion` in front of the Worker — so the upgrade arrives
 * carrying exactly what every other request here carries.
 *
 * This route is mounted *before* `cacheControlMiddleware` in `index.ts`. A 101
 * response is not an ordinary response: its `webSocket` cannot survive being
 * rebuilt to add a header, so anything that touches headers on the way out
 * has to stay off this path. The middleware also skips 101s itself, so the
 * ordering is belt and braces rather than the only thing holding it up.
 */
live.get("/", async (c) => {
  // A plain GET here is a mistake worth naming rather than a socket to open —
  // most likely someone testing the endpoint in a browser tab.
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected a WebSocket upgrade" }, 426);
  }

  // No binding in local dev without `wrangler dev` and in some test configs.
  // 503 rather than 500: the client reads it as "poll instead", which is a
  // working app, not an error.
  if (!c.env.LIVE) {
    return c.json({ error: "Live updates unavailable" }, 503);
  }

  const childId = parseInt(c.req.query("child_id") || "0", 10);
  if (!childId || !(await verifyChildExists(c.env.DB, childId))) {
    return c.json({ error: "Child not found" }, 404);
  }

  const stub = c.env.LIVE.get(c.env.LIVE.idFromName(liveRoomName(childId)));
  return stub.fetch(c.req.raw);
});
