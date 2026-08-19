import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { fetchBoopLinePool, refreshBoopLines } from "../scheduled/boopLines.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const boopLines = new Hono<AppEnv>();

// GET /api/boop-lines — the current AI-written pool, for the client to merge
// with its own built-in lines. Empty arrays (no rows yet, or an environment
// with no AI binding) are a normal answer, not an error.
boopLines.get("/", async (c) => {
  const pool = await fetchBoopLinePool(c.env);
  return c.json(pool);
});

// POST /api/boop-lines/refresh — ask the model for a few new lines right
// now, instead of waiting for the weekly cron. Same idea as
// /api/daily-notes/refresh: any logged-in user can call it, and it only ever
// adds rows to boop_lines, so there's nothing it can do to anyone else's data.
boopLines.post("/refresh", async (c) => {
  const result = await refreshBoopLines(c.env);
  return c.json(result);
});

export { boopLines };
