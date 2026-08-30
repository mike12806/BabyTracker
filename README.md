# Baby Tracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy), built for Cloudflare's edge platform.

## Features

- **Multi-child support** — track multiple children, each linked to one or more users
- **Comprehensive tracking** — feedings, diaper changes, sleep, tummy time, pumping, growth, temperature, notes, and timers
- **Photo uploads** — child profile photos stored securely in Cloudflare R2
- **Daily note** — a short blurb on the dashboard about how yesterday went and how the week is trending, written once a day by Workers AI and cached in D1
- **Boop lines** — the reward for tapping a child's photo cycles through a pool that a weekly cron tops up with new AI-written lines, so it doesn't go stale
- **Feeding trend alerts** — at 11am, 4pm and 7pm Eastern, checks how much a child has been fed so far today against the same point on each of the previous seven days, and pushes a notification when Workers AI agrees the shortfall is worth knowing about
- **In-app alerts** — a bell in the app bar opens the list of alerts the server has raised, so a notification that was swiped away, went to the other parent's phone, or was never delivered at all is still there to read
- **Offline logging** — an entry saved while the server is unreachable is kept on the device, shown in the log marked as unsynced, and sent automatically when the connection returns; the idempotency keys behind every create mean a resend can't double-log it
- **Secure by default** — authentication via Cloudflare Access (no custom login UI needed)
- **Edge-native** — runs entirely on Cloudflare (Pages, Workers, D1, R2)

## Architecture

| Component | Technology | Deployment |
|-----------|-----------|------------|
| Client | React + Vite + MUI | Cloudflare Pages |
| Server | Hono (TypeScript) | Cloudflare Workers |
| Database | D1 (SQLite) | Cloudflare D1 |
| Object Storage | R2 | Cloudflare R2 |
| Auth | Cloudflare Access | JWT validation |
| Email delivery | Cloudflare Queues + SES | Retried, with a dead letter queue |
| Daily note generation | Cloudflare Queues | Retried; template note written up front |
| Daily note | Workers AI | One generation per child per day, cached in D1 |
| Boop line generation | Cloudflare Queues | Retried; weekly, not per-child |
| Boop lines | Workers AI | A handful of new lines a week, cached in D1 |
| Feeding trend analysis | Workers AI | Three checks a day, only when the figures already show a shortfall |
| Feeding trend delivery | Cloudflare Queues | Retried; one job per subscribed device |
| In-app alerts feed | D1 (`alerts`) | Written where the alert is decided, read back by the app's bell |
| Offline writes | Device-local outbox | Foreground flush, deduplicated server-side by `client_request_id` |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Install

```sh
npm install
```

### Local Development

```sh
# Start the API server (with local D1 + R2)
npm run dev:server

# Start the client dev server (in another terminal)
npm run dev:client
```

### Seed Data

Populate a local D1 database with sample data:

```sh
npm run db:seed
```

### Run Tests

```sh
# All tests
npm test

# Server only
npm run test:server

# Client only
npm run test:client
```

### Build

```sh
npm run build:client
npm run build:server
```

## The daily note

The dashboard's hero card carries a two-sentence note about the previous day —
what was logged, how it compares to that child's own last week, and a line of
encouragement.

The figures in it are computed in SQL, never by the model: an LLM asked to add
up feed counts will occasionally get it wrong, and a note that misreports how
much a baby ate is worse than no note. The model is handed finished numbers and
asked only to write the sentences around them.

Cost is bounded by design. Generation happens once per child per day from the
existing cron and is cached in a `child_daily_notes` row, so reads are one
indexed D1 lookup and opening the app never reaches the model. At roughly 350
input and 55 output tokens per call, that is well under 1% of Workers AI's
10,000 Neuron daily free allocation — under a nickel a year per child even at
paid rates.

Because the volume is that low, the model is chosen on writing quality rather
than price: the gap between the cheapest and the largest plausible candidate is
a few cents a year, while the gap in how the sentences read is not. The default
is Gemma 4 26B (an MoE with 4B active — fast, and markedly better prose than
an 8B). It has "thinking mode," which has two consequences worth knowing, both
of which broke this feature once before being handled:

1. **Response shape.** Workers AI answers models like this one
   OpenAI-chat-completions-style (`choices[0].message.content`, with any
   reasoning trace separated into `.reasoning_content` beside it), not the
   flatter `{ response }` shape simpler models use. `extractModelText` reads
   both.
2. **Token budget.** Reasoning tokens come out of the same `max_tokens`
   allowance as the visible answer, so a budget sized for "two sentences" gets
   spent thinking and returns empty content with `finish_reason: "length"`.
   `MAX_REPLY_TOKENS` is deliberately generous; billing is on tokens actually
   produced, and `tidyNote` still clips the stored note to `MAX_NOTE_LENGTH`.

Both failures look identical from the outside — a working call that produces a
template note — so `generateNoteBody` now returns a `reason` whenever it falls
back, naming `finish_reason`, token usage and the response keys it actually
saw. The refresh button surfaces that reason directly instead of just "0 from
AI".

There is no fallback to worry about breaking: with no `AI` binding — local dev
and the tests have none — or on any model error, a deterministic template
writes the same true sentences in a fixed voice, and the row records which
wrote it (`source` is `ai` or `fallback`, so a run of fallbacks is how you spot
a misconfigured binding).

The note is text-only. No photo is ever sent to a model. Feeding amounts in it
are always in ounces, regardless of any reader's own mL/oz display
preference — it's one row shared by everyone who reads it, so it can't
actually be per-user. A small sparkle icon sits next to the note on the
dashboard, but only when `source` is `ai`; the fallback template gets no
sparkle, since it isn't AI-written.

The cron does not generate the note itself. It writes each child's template
note immediately — so the card always has something true on it — and enqueues
the model call on `baby-tracker-daily-note`; the consumer replaces the row when
a real note arrives. That exists for retries: a cron trigger does not re-run,
so before this a single transient model failure (Workers AI answers "out of
capacity" often enough to plan for) cost that child their real note for the
whole day.

There is deliberately no dead letter queue behind it, unlike the summary email.
A note that exhausts its retries has already left a correct, readable fallback
on the card and recorded `source = 'fallback'` in the row, so a queue of unread
messages would add nothing the database does not already say.

The manual refresh button stays synchronous, because a human is waiting on it
and wants the reason when the model declines.

To change the model, set `DAILY_NOTE_MODEL` in `server/wrangler.toml`.

## Boop lines

Tapping a child's photo on the hero card cycles through a short reaction line
("Boop.", "Squish.", "Certified good baby."). Those are baked into the client
(`client/src/utils/childMoments.ts`) and always work on their own — nothing
below is required for the feature to function.

On top of them, a weekly cron (`server/src/scheduled/boopLines.ts`) asks
Workers AI for a handful of new lines in the same voice — a few for daytime,
a few for the quieter after-hours mood — and stores them in a `boop_lines`
table, capped and rotating so the pool doesn't grow forever. The dashboard
fetches the current pool once per session and merges it in behind the
built-ins, so the joke keeps finding new material without anyone hand-writing
it.

Structured like the daily note's queue for the same reason: the cron enqueues
one job per mood on `baby-tracker-boop-lines`, and the consumer does the
actual generation, so a transient Workers AI failure gets retried instead of
costing that week's lines. Simpler in two ways the daily note isn't, because
nothing here is time-critical: no per-line fallback content (a line the model
didn't write just isn't added), and no dead letter queue (a mood that
exhausts its retries just keeps the lines it already had).

Weekly rather than daily — there's no reason for the pool to turn over as
often as a note that describes a specific day. `POST /api/boop-lines/refresh`
generates inline on demand, same idea as the daily note's refresh route. To
change the model, set `BOOP_LINES_MODEL` in `server/wrangler.toml`.

## Feeding trend alerts

Three times a day — 11am, 4pm and 7pm Eastern — the Worker
(`server/src/scheduled/feedingTrend.ts`) compares how much each child has been
fed *so far today* against how much they had been fed by the same point on each
of the previous seven days. If today is meaningfully behind, it asks Workers AI
whether that is worth interrupting the parents' day over, and pushes a Web Push
notification to every subscribed device when the answer is yes.

Three rules shape it:

- **The numbers are computed in SQL, never by the model** — same rule the daily
  note follows. A notification that misreports how much a baby ate is worse
  than no notification.
- **The model can only veto an alert, never invent one.** `compareFeeding`
  decides whether there is a shortfall (more than 15% below the baseline on
  feed count *or* on volume); the model is only asked once that has already
  happened, and its job is to say whether it deserves a buzz and to write the
  sentence. A model that is down, rate-limited or babbling therefore costs a
  nicer wording, never a missed alert — the template sentence says the same
  true figures.
- **The decision happens on the cron, the delivery on the queue** — same split
  as the reminder pushes, so a push-service hiccup is retried for that one
  device without re-deciding anything or re-notifying the others. Unlike the
  daily note, the *model call* is not retried: this alert is about the day it
  is still in, and a "behind by 11am" push that lands at noon has lost most of
  its point.

The comparison is like-for-like. Each baseline window is the same elapsed
length as today's rather than ending at the same wall-clock time, so a daylight
saving change can't masquerade as a feeding trend, and the baseline averages
only over days that actually have a feeding logged — at least three of them, or
no alert is possible at all. Volume is only compared when both sides measured
some, so a household that breastfeeds and logs no amounts is judged on feed
count alone rather than being permanently "0 oz below".

Every check that gets as far as needing a decision is recorded in
`feeding_trend_checks` — what was decided, the sentence, and whether the model
or the template wrote it. That row is also the idempotency key: it is claimed
before anything is sent, so one child can only be alerted once per checkpoint
however many times the cron fires.

Those checkpoints are local times and cron is UTC, so the trigger fires at six
UTC hours — the EDT and the EST translation of each — and the handler discards
the three that don't land on an Eastern checkpoint hour. Three checks a day,
year-round, with no DST drift.

`POST /api/feeding-trend/check` runs the whole analysis for right now and
returns it — the figures, the comparison and what the model made of it —
without notifying anyone or spending the checkpoint, which is the only way to
see the feature work before 11am. Add `?send=1` to run it exactly as the cron
would. To change the model, set `FEEDING_TREND_MODEL` in
`server/wrangler.toml`.

## In-app alerts

Every alert the Worker raises — an overdue diaper or feeding reminder, a
feeding-trend alert — is also written to the `alerts` table, and the bell in
the app bar reads it back. Tapping it opens a drawer with the alerts for the
children you're linked to, newest first, with the ones that arrived since your
last visit marked.

Push and this list are deliberately not the same thing. A notification swiped
off a lock screen is gone, while the thing it was telling you about — nobody
has logged a feed since 8am — is still true. A push only ever reaches the
devices that opted in, and two people sharing a child rarely both have
notifications on. And on an installed iOS PWA, which is most of the installs
here, push is the least reliable link in the whole chain.

So the rows are written where the alert is *decided*, in the cron, behind the
same claim that stops a double firing from double-pushing — not in the queue
consumer that sends them. An alert is recorded even when nobody is subscribed
to push at all, which is the case the feed exists for. Each row stores the
sentence that was sent, word for word, rather than re-deriving it on read: a
trend alert's figures describe the moment it was raised.

Read state is per user and is a single "last read at" mark, so opening the
drawer clears your badge without touching anyone else's. Dismissing an alert
is per user too, and hides rather than deletes: the row is shared by everyone
linked to the child, so throwing it away would take an alert off the other
parent's bell — possibly one they haven't read — and destroy the record the
feed exists to keep. Every dismissal can be undone from the drawer. The feed
keeps 30 days and is pruned by the daily cron.

## Live updates

Log a feed on one phone and it appears on the other one's dashboard straight
away, rather than up to a minute later. Each device holds a WebSocket to the
child it is looking at; every write tells that child's Durable Object, which
nudges everyone else watching. The nudge carries no entry data — it only says
"something changed", and the app fetches it over the ordinary API, so nothing
is cached and nothing can be stale.

The poll it replaced is still there underneath, at five minutes instead of one.
A socket that has quietly stopped delivering looks exactly like a quiet
afternoon, and this app would rather pay for a slow poll than show a stale
number. If the socket cannot be established at all the app notices after a few
attempts and goes back to polling every minute, which is where it started.

## Offline behaviour

The app is installed as a PWA and used in places the wifi doesn't reach, so
"the server is unreachable" is an ordinary state rather than an error. Reads
and writes are handled in opposite ways, on purpose.

**Reads keep nothing.** Nothing caches API responses — not the service worker,
not an HTTP cache (`Cache-Control: no-store`). When a refresh fails the app
keeps whatever it last rendered and says so in a banner naming its age, then
retries with a cheap ping until the server answers. A saved copy of the
server's answer reads as a fact about the baby and can be false; unavailable
but honest beats readable but wrong.

**Writes keep everything.** A create that can't reach the server is queued on
the device (`client/src/api/outbox.ts`) and sent on the next signal the server
is back — coming online, the app being foregrounded, a successful ping, or a
periodic retry. Queued entries appear in the log where their own timestamp puts
them, marked "not synced", and a banner counts them with the option to sync
now or discard. Nothing is dropped without the user saying so: an entry the
server rejects outright (a 4xx — the child was deleted, say) is set aside with
the server's message rather than retried forever.

Safety comes from the idempotency key every create already carries. The queued
entry keeps the `client_request_id` it was given when Save was pressed, so a
resend against a server that already applied it is answered with the original
row instead of logging a second feed.

A few deliberate limits:

- **Only creates are queued.** An edit or delete replayed later would overwrite
  whatever the other caregiver did to the same row in the meantime.
- **The queue drains in the foreground.** Background Sync isn't available on
  iOS Safari, so entries go out when the app is open, not while it's closed.
- **Two people logging the same real-world feed still make two rows.** That
  happens whether or not anyone is offline, and it isn't auto-merged: the app
  can't tell "logged twice" from "fed twice", and deleting a real second feed
  is the worse mistake.

## Deployment

### 1. Create Cloudflare resources

```sh
# D1 database
npx wrangler d1 create baby-tracker-db

# R2 bucket for photos
npx wrangler r2 bucket create baby-tracker-photos

# Queues for daily summary delivery (the deploy workflow also creates these)
npx wrangler queues create baby-tracker-daily-summary
npx wrangler queues create baby-tracker-daily-summary-dlq
npx wrangler queues create baby-tracker-daily-note
npx wrangler queues create baby-tracker-boop-lines
npx wrangler queues create baby-tracker-reminders
npx wrangler queues create baby-tracker-feeding-trend
```

Queues require the Workers Paid plan, and the API token used by CI needs
**Queues:Edit** in addition to Workers and D1 permissions — `wrangler deploy`
rejects a Worker whose queue bindings do not resolve.

### Secrets

```sh
wrangler secret put AWS_SES_ACCESS_KEY
wrangler secret put AWS_SES_SECRET_KEY
wrangler secret put REPORT_FROM_EMAIL   # verified SES sender
wrangler secret put ALERT_EMAIL         # optional
```

`ALERT_EMAIL` is where a daily summary that could not be delivered gets
reported, after its retries are exhausted and it lands in the dead letter
queue. It falls back to `REPORT_FROM_EMAIL` — worth setting explicitly if that
is a `noreply@` nobody reads, since the alert would otherwise be as invisible
as the failure it exists to surface. Whichever address you use has to be
deliverable under your SES setup (a sandboxed SES account can only send to
verified recipients).

### 2. Configure

Update `server/wrangler.toml` with your D1 database ID, Cloudflare Access team domain, and audience tag.

### 3. Run migrations

```sh
npx wrangler d1 migrations apply baby-tracker-db
```

### 4. Deploy

```sh
# Deploy the Worker API
npm run build:server
npx wrangler deploy -c server/wrangler.toml

# Deploy the client
npm run build:client
npx wrangler pages deploy client/dist
```

### 5. Secure with Cloudflare Access

Add both the Pages site and Worker API to a Cloudflare Access application to protect them with your identity provider.

## Project Structure

```
├── client/              # React + Vite SPA
│   ├── src/
│   │   ├── api/         # API client and the offline write outbox
│   │   ├── components/  # Layout, shared components
│   │   ├── hooks/       # Auth & children context
│   │   ├── pages/       # Route pages
│   │   └── types/       # TypeScript models
│   └── test/
├── server/              # Hono Cloudflare Worker
│   ├── src/
│   │   ├── middleware/   # Auth (CF Access JWT)
│   │   ├── routes/       # REST API routes
│   │   └── types/        # Env bindings
│   ├── migrations/       # D1 SQL migrations
│   ├── seed/             # Sample data
│   └── test/
└── package.json          # npm workspaces root
```

## License

[MIT](LICENSE)
