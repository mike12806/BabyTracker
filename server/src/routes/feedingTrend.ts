import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { runFeedingTrendCheck } from "../scheduled/feedingTrend.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const feedingTrend = new Hono<AppEnv>();

// POST /api/feeding-trend/check — run the feeding-trend analysis for right
// now and return it: today's feeds and volume so far, the same span averaged
// over the previous seven days, and what the model made of the difference.
//
// Exists for the same reason /api/daily-notes/refresh does — there is no way
// to fire a deployed Worker's cron trigger from outside it, so without this
// the only way to see the analysis is to wait for 11am, 4pm or 7pm Eastern.
//
// Sends nothing by default. Pass `?send=1` to run it exactly as the cron
// would: claim the checkpoint (so it can only fire once per child per
// checkpoint) and push to every subscribed device. Without it the whole
// analysis still runs — figures, model and all — it just stops short of
// notifying anyone or consuming the checkpoint, which is what you want when
// checking whether the thing works.
feedingTrend.post("/check", async (c) => {
  const send = ["1", "true", "yes"].includes((c.req.query("send") ?? "").toLowerCase());
  const checks = await runFeedingTrendCheck(c.env, { send });
  return c.json({ send, checks });
});

export { feedingTrend };
