import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const push = new Hono<AppEnv>();

// GET /api/push/vapid-public-key — the client needs this to call
// pushManager.subscribe(). Served from an endpoint rather than baked into the
// client bundle so the key can rotate without a rebuild.
push.get("/vapid-public-key", async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) {
    return c.json({ error: "Push notifications are not configured" }, 501);
  }
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — body is the shape PushSubscription.toJSON()
// produces. Upserted by endpoint: re-subscribing (e.g. after a permission
// reset) just refreshes the row rather than erroring on the UNIQUE constraint.
push.post("/subscribe", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "endpoint and keys.p256dh/keys.auth are required" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  )
    .bind(userId, body.endpoint, body.keys.p256dh, body.keys.auth)
    .run();

  return c.json({ ok: true }, 201);
});

// DELETE /api/push/subscribe?endpoint=... — a query param rather than a body,
// matching the client's shared `api.delete()`, which sends none. Scoped to
// the caller so one user can't unsubscribe another's device.
push.delete("/subscribe", async (c) => {
  const userId = c.get("userId");
  const endpoint = c.req.query("endpoint");

  if (!endpoint) {
    return c.json({ error: "endpoint is required" }, 400);
  }

  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(endpoint, userId)
    .run();

  return c.json({ ok: true });
});

export { push };
