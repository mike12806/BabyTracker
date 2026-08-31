# BabyTracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy).

## Project Overview

Monorepo for a baby tracking application. Two packages:

- `client/` — React + Vite SPA deployed to Cloudflare Pages
- `server/` — Hono-based Cloudflare Worker API deployed to Cloudflare Workers, backed by Cloudflare D1

## Architecture

- **Client**: React + Vite SPA served from Cloudflare Pages. Communicates with the backend via REST API.
- **Server**: Single Cloudflare Worker using Hono as the router. Uses Cloudflare D1 (SQLite-compatible) for persistence.
- **Auth**: Cloudflare Access. Both the client (Pages) and server (Worker) are behind Cloudflare Access. The Worker validates the `Cf-Access-Jwt-Assertion` header, extracts the user's email, and auto-creates a user row on first request. No custom login UI or session management needed. Access must stay a **hostname-based (self-hosted) application** on `baby.mfaherty.net`, which is what it is today: a *Worker-level* Access policy rejects WebSocket upgrades with a 403, which would take the live updates above out entirely. Nothing in the Worker changes for a socket — the browser sends the `CF_Authorization` cookie on a same-origin handshake and Access injects the JWT header in front of it, so `authMiddleware` authenticates an upgrade exactly like every other request.
- **Database**: Cloudflare D1. Migrations live in `server/migrations/`. Use sequential numbered migration files.
- **Daily summary email**: a cron trigger enqueues one message per reader onto a Cloudflare Queue; the queue consumer renders and sends it via SES. Failed sends are retried and end up in a dead letter queue rather than being dropped. Without the queue binding (local dev, tests) the same code sends inline.
- **Daily note**: the same cron writes one short AI blurb per child into `child_daily_notes` (see `server/src/scheduled/dailyNote.ts`). All figures are computed in SQL and handed to the model — the model only writes prose around them. Cached in D1 so reads never trigger inference; without the `AI` binding a deterministic template is used instead. The vitest pool points at `wrangler.test.toml`, which omits the `[ai]` binding — declaring it forces a remote proxy session that needs a real API token. The cron writes each child's template note and enqueues the model call on `baby-tracker-daily-note`; the consumer replaces it with the AI version, retrying transient model failures (a cron trigger does not re-run, so without the queue one bad minute cost that child their note for the day). No DLQ: an exhausted retry has already left a correct fallback on the card and `source = 'fallback'` in the row. `POST /api/daily-notes/refresh` regenerates on demand — the only way to see a note without waiting for the next cron run, since there is no way to fire a deployed Worker's cron trigger from outside it. It never touches `sendDailySummary`, so calling it can't send real email.
- **Boop lines**: a weekly cron (`BOOP_LINES_CRON` in `server/src/index.ts`) tops up the `boop_lines` table with a few new AI-written reaction lines per mood (day/night) — see `server/src/scheduled/boopLines.ts`. These are shown on the dashboard hero card when a child's photo is tapped, merged in behind the fixed lines baked into `client/src/utils/childMoments.ts` (`boopMessage`), which remain the permanent fallback. Structured like the daily note's queue: the cron enqueues one job per mood on `baby-tracker-boop-lines`, and the consumer generates and stores that mood's lines, retrying on a transient model failure. No per-line fallback content and no DLQ — a mood that exhausts its retries just keeps whatever lines it already had, which is fine for something this low-stakes. Pool is capped per mood (`POOL_CAP_PER_MOOD`); the oldest rows are pruned after each refresh so it rotates rather than growing forever. `POST /api/boop-lines/refresh` generates inline on demand. `GET /api/boop-lines` returns the current pool; the client fetches it once per session, not per child.
- **Feeding trend alerts**: a cron at 11am/4pm/7pm ET (`FEEDING_TREND_CRON` in `server/src/index.ts`) compares each child's feeding so far today against the same elapsed span on each of the previous 7 ET days — see `server/src/scheduled/feedingTrend.ts`. Same "figures in SQL, prose from the model" rule as the daily note, plus one of its own: `compareFeeding` decides whether there is a shortfall (>15% below baseline on feed count or volume) and the model is only consulted once it has, so the model can *veto* an alert but never invent one; every failure path keeps the alert and falls through to the template sentence. Unlike the daily note the model call is **not** queued or retried — the alert is about the day it is still in, so a late better wording is worth less than a prompt template one; only the push delivery goes on `baby-tracker-feeding-trend`, one job per subscribed device, like the reminder queue. Checkpoints are ET clock hours and cron is UTC, so the trigger fires at six UTC hours (the EDT and EST translation of each) and `runFeedingTrendCron` discards the three that don't land on an ET checkpoint — three checks a day year-round with no DST drift. `feeding_trend_checks` is both the audit trail and the idempotency key: the row is claimed before anything is sent, so a doubled cron firing can't double-push. `POST /api/feeding-trend/check` runs the analysis and returns it without notifying anyone or spending the checkpoint; `?send=1` runs it exactly as the cron would.
- **In-app alerts feed**: every alert this Worker raises is also recorded in `alerts` (see `server/src/alerts.ts`), and the app's bell reads it back through `GET /api/alerts`. Push is the notification, this is the record — they are not the same thing: a push swiped off a lock screen is gone while the thing it reported is still true, it only ever reached the devices that opted in (one caregiver here routinely has notifications off), and on an installed iOS PWA it is the least reliable link in the chain. So rows are written where the alert is *decided* — in `reminders.ts` behind the `reminder_state` claim, in `feedingTrend.ts` behind the checkpoint claim — never in the queue consumer, which would mean one row per device, and none at all when nothing is subscribed. `dedupe_key` is the same occasion identity each caller already guards its push with, so a doubled cron can't double-log. `recordAlert` never throws: a feed write failing is not a reason for the push itself not to go out. Unread is per user and is a single `alert_reads.last_read_at` mark rather than a row per (user, alert) — the bell only ever asks "how many since you last looked". Dismissing (`POST /api/alerts/:id/dismiss`, undone by `/restore`) writes a per-user row in `alert_dismissals` and hides the alert from that user's list and count only: the `alerts` row is shared by everyone linked to the child, so deleting it would take an unread alert off the other parent's bell and destroy the record the feed exists to keep. Pruned to 30 days by the daily note cron, and the dismissals cascade with it.
- **Answered reminders**: an overdue diaper/feeding reminder is a statement about a *gap*, so the entry that ends the gap ends the alert — the create path for feedings and diaper changes calls `clearReminderAlerts` (`scheduled/reminders.ts`), which stamps `alerts.resolved_at` and drops the spent `reminder_state` claim. Unlike a dismissal this is not per user: the condition itself ended, so the alert leaves every linked reader's feed and count at once, and `resolveAlerts` nudges the child's watchers so the other parent's bell drops it without waiting for a poll. Resolved, never deleted — the row carries the `dedupe_key` and is the record. Whether an entry answers the alert is decided by re-asking the cron's own question of the table (is anything logged inside the threshold?) rather than by trusting the posted timestamp, so backfilling an old feed cannot silence a live reminder. It also clears the `reminder_state` row, because that column holds the *clock time the push went out*: a feed logged with a time slightly earlier than the notification would otherwise leave the claim ahead of the newest activity and swallow the next gap's reminder. The push already delivered is retracted by the client, not the server — reminder pushes carry a `tag` (`reminderNotificationTag`) that `client/src/utils/reminderNotifications.ts` rebuilds from the feed, closing on every bell refresh the reminder notifications the feed no longer accounts for. Both halves of the tag string must stay in step.
- **Live updates**: entry changes are pushed to the other caregivers' devices over a WebSocket rather than found by polling — see `server/src/live.ts`. One Durable Object per child (`child:<id>`) holds the open sockets; every write path calls `announceChange`, and the DO fans a nudge out to everyone watching that child. **What crosses the socket is a signal, never data**: `{ type, kind, at }` and nothing else. The client bumps `refreshKey` and refetches over the same `/api/*` routes as before, so the "API data is never cached, anywhere" rule in `client/AGENTS.md` is untouched — a nudge has nothing in it that can go stale. A plain Worker cannot do this: the isolate that completed a handshake is not addressable from the later request that logs a feed, which is what the DO's name solves. Sockets are accepted with `ctx.acceptWebSocket()` (hibernation), so an idle household is evicted from memory and billed no duration; nothing in that class may hold a `setInterval`, `setTimeout` or alarm, all of which silently disable hibernation. Heartbeats are answered by `setWebSocketAutoResponse` and never wake the object. The binding is optional throughout — `notifyChange` no-ops without it and the client falls back to polling — so a missing or blocked socket costs latency, never correctness. Two changes are deliberately *not* delivered live, because a socket is a subscription to one child: a newly added child (nobody is subscribed to a room that has just come into existence) and an alert for a child nobody is currently viewing. Both arrive on the backstop poll, which is the latency they had before.
- **Offline writes**: a create the client cannot deliver is queued on the device (`client/src/api/outbox.ts`) and flushed when the server is reachable again. It is safe because the queued body keeps its `client_request_id`, so a resend is deduplicated server-side rather than logging the entry twice. Only creates are queued — an edit or delete replayed later would overwrite a concurrent change it never saw. Reads are unaffected: nothing caches API responses, by design. See `client/AGENTS.md` for the PWA constraints and the conflict analysis.
- **Multi-tenancy**: Multiple users, each linked to one or more children via a junction table. Users are auto-created from the Cloudflare Access JWT email.

## Domain Model

Core entities modeled after Baby Buddy:

- **Child** — name, birth date
- **Feeding** — type (breast left/right, bottle (breast milk/formula), solid), start/end time, amount, notes
- **Diaper Change** — time, type (wet/solid/both/none), color, notes
- **Sleep** — start/end time, nap vs. night, notes
- **Tummy Time** — start/end time, milestone, notes
- **Pumping** — start/end time, breast side (left/right/both), amount, notes
- **Growth** — date, weight, height, head circumference
- **Temperature** — time, reading, notes
- **Note** — freeform note attached to a child and time
- **Timer** — active timers for in-progress events (feedings, sleep, tummy time)

All entries are associated with a child. Multi-child support is required.

## Code Style

- TypeScript everywhere (client and server)
- Use ES modules (`import`/`export`), never CommonJS
- Prefer `const` over `let`; never use `var`
- Use strict TypeScript (`strict: true` in tsconfig)

## Conventions

- API routes follow REST conventions: `GET /api/resource`, `POST /api/resource`, `PUT /api/resource/:id`, `DELETE /api/resource/:id`
- All API routes are prefixed with `/api/`
- Use ISO 8601 for all date/time fields in API requests and responses
- D1 queries use prepared statements with bound parameters — never interpolate user input into SQL
- POST creates accept an optional `client_request_id` and deduplicate on it, so a retried or double-tapped save cannot log the same entry twice. The offline outbox depends on this: it is what makes replaying a queued entry safe. Any new create route must support it. Use `insertOnce` for single-statement creates — it writes the row and claims the key in one `D1.batch()`, which D1 runs as a transaction
- Creates that write more than one row (e.g. a child plus its `user_children` link) must use `D1.batch()` so they cannot half-apply
- Hono is the sole router — define routes in modular files and mount them on the main app
- Environment variables and secrets are accessed via the Worker's `Env` bindings, not `process.env`
- User identity is derived from the Cloudflare Access JWT and used to scope all data access
- Users can only access children they are linked to via the `user_children` table

## Build and Test

- Package manager: `npm` with workspaces
- Install: `npm install` (from root)
- Build client: `npm run build -w client`
- Build server: `npm run build -w server`
- Dev: `npm run dev` (from respective package)
- Test: `npm test` (from respective package)
- Deploy: `npx wrangler pages deploy` (client), `npx wrangler deploy` (server)

## Database

- D1 migrations are plain SQL files in `server/migrations/`
- **Migrations are applied automatically on every deploy** — `deploy-server.yml` runs `wrangler d1 migrations apply baby-tracker-db --remote` before the Worker upload, and wrangler tracks what it has already run, so a new migration file needs nothing beyond being merged. Never tell the user a migration "still needs applying": adding the file *is* shipping it.
- Always create reversible migrations when possible
- Use `INTEGER` for booleans (0/1) — D1 is SQLite-compatible
- Store timestamps as ISO 8601 text strings
- Every table includes `created_at` and `updated_at` columns
- Multi-statement writes go through `D1.batch()`, which is transactional; `last_insert_rowid()` inside a batch refers to the statement immediately before it
