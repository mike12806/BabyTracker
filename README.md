# Baby Tracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy), built for Cloudflare's edge platform.

## Features

- **Multi-child support** — track multiple children, each linked to one or more users
- **Comprehensive tracking** — feedings, diaper changes, sleep, tummy time, pumping, growth, temperature, notes, and timers
- **Photo uploads** — child profile photos stored securely in Cloudflare R2
- **Daily note** — a short blurb on the dashboard about how yesterday went and how the week is trending, written once a day by Workers AI and cached in D1
- **Boop lines** — the reward for tapping a child's photo cycles through a pool that a weekly cron tops up with new AI-written lines, so it doesn't go stale
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
│   │   ├── api/         # API client
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
