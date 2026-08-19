import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { refreshDailyNotes } from "../scheduled/dailyNote.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const dailyNotes = new Hono<AppEnv>();

// POST /api/daily-notes/refresh — regenerate every child's note for the
// current window right now, instead of waiting for the midnight cron.
//
// Exists for the gap between deploying this feature (or a prompt change) and
// the next scheduled run — otherwise the only way to see the result is to
// wait up to a day. Any logged-in user can call it: it is idempotent (upserts
// on child_id + note_date, same as the cron), touches only
// child_daily_notes, and — unlike the cron's `scheduled()` handler — never
// goes near sendDailySummary, so calling it can't send a real email to
// anyone.
dailyNotes.post("/refresh", async (c) => {
  const written = await refreshDailyNotes(c.env);
  return c.json({ written });
});

export { dailyNotes };
