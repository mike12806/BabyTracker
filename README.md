# Baby Tracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy), built for Cloudflare's edge platform.

## Features

- **Multi-child support** — track multiple children, each linked to one or more users
- **Comprehensive tracking** — feedings, diaper changes, sleep, tummy time, pumping, growth, temperature, notes, and timers
- **Photo uploads** — child profile photos stored securely in Cloudflare R2
- **Daily note** — a short blurb on the dashboard about how yesterday went and how the week is trending, written once a day by Workers AI and cached in D1
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
| Daily note | Workers AI | One generation per child per day, cached in D1 |

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
is Gemma 4 26B (an MoE with 4B active — fast, and not a reasoning model, so
there is no thinking trace to strip).

There is no fallback to worry about breaking: with no `AI` binding — local dev
and the tests have none — or on any model error, a deterministic template
writes the same true sentences in a fixed voice, and the row records which
wrote it (`source` is `ai` or `fallback`, so a run of fallbacks is how you spot
a misconfigured binding).

The note is text-only. No photo is ever sent to a model.

To change the model, set `DAILY_NOTE_MODEL` in `server/wrangler.toml`.

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
