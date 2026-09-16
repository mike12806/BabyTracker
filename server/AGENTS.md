# Server — Hono Cloudflare Worker + D1

## Stack

- Hono as the HTTP router
- Cloudflare D1 (SQLite) for persistence
- Cloudflare KV (`CACHE`) as a read cache in front of D1 — never a source of truth
- Workers Analytics Engine (`METRICS`) for infrastructure telemetry — write-only, optional, never on a correctness path
- Cloudflare Access for auth (JWT validation)
- Deployed as a single Cloudflare Worker

## Structure

- `src/index.ts` — Worker entry point, mounts route modules
- `src/routes/` — One file per resource (children, feedings, diapers, sleep, etc.)
- `src/middleware/` — Hono middleware (auth, error handling)
- `src/kv/` — The KV read cache: `keys.ts` (every key, all versioned), `ttl.ts` (how long each may be wrong for), `cache.ts` (the read-through helpers)
- `src/telemetry.ts` — Every Analytics Engine event, and the positional schema they share
- `src/db/` — Database query helpers and types
- `src/types/` — Shared TypeScript types
- `migrations/` — D1 migration SQL files
- `kv-migrations/` — KV migrations, run by `scripts/kv-migrate.mjs`

## Conventions

- Every route file exports a `Hono` instance that gets mounted in `index.ts`
- All routes are prefixed with `/api/`
- Use Hono's `c.env.DB` to access the D1 binding
- Always use `c.req.valid()` with Zod or Hono's built-in validators for request validation
- Return JSON responses with `c.json()` — include appropriate HTTP status codes
- Use `c.var` for middleware-injected values (e.g., authenticated user email)

## Auth — Cloudflare Access

- Cloudflare Access handles login — the Worker never sees credentials
- Auth middleware validates the `Cf-Access-Jwt-Assertion` header on every request
- Extract the user's email from the JWT payload
- Auto-create/match user by email in the `users` table (upsert on every request)
- Set `c.set('userId', id)` and `c.set('userEmail', email)` for downstream route handlers
- `/api/auth/me` returns the current user profile from the JWT identity
- Reject requests with missing or invalid JWT with 401
- CF Access policy team domain and audience (AUD) come from Worker env bindings

## D1 Patterns

- All queries use prepared statements: `c.env.DB.prepare(sql).bind(...params)`
- Use `.all()` for SELECT queries, `.run()` for INSERT/UPDATE/DELETE
- Never string-concatenate user input into SQL
- Wrap multi-table writes in D1 batch: `c.env.DB.batch([stmt1, stmt2])`
- Return `created_at` and `updated_at` in all responses

## KV Patterns

- `cached(env, key, ttl, load)` is the only way to read: cache hit, or `load()` and write back. `load` is not wrapped — a D1 failure is real and belongs to the caller, unlike a KV one
- Every write path drops the keys it invalidates, at the single choke point where the row is written (`storeNote`, `storeBoopLines`) rather than at each call site
- Cache `null` where "there is nothing" is a real answer — the envelope in `cache.ts` exists to tell it apart from a miss, and without it a child with no note yet would read D1 on every dashboard load
- Cache the *row*, not the answer. Anything time-dependent (an age cutoff, a "within N days" filter) is re-applied after the read, or the cache freezes the clock at the moment of the miss
- Never cache entry data or user settings — see the rule in the root `AGENTS.md`. If you are reaching for a cache to make a list endpoint faster, the answer is an index, not KV
- `JWKS_TTL_SECONDS` is the one TTL here that is a *security* bound, not a freshness one: it governs how long a signing key Cloudflare has withdrawn stays trusted. Raising it to save fetches trades a revocation window for nothing that matters — a new key is already picked up on the first request that carries it

## Telemetry Patterns

- One function per event in `src/telemetry.ts`; call sites never touch `writeDataPoint` directly
- The layout is the schema — Analytics Engine addresses `blob1..blob20` by position, not by name. `blob1` is the event name, every other position is documented on its function, and a position keeps its meaning forever. Append, never repurpose
- Put a 1/0 in `doubles` alongside any string outcome worth a rate: `avg(double1)` is the figure anyone actually wants, and it is awkward to get from a blob
- Record at the point that already knows the answer. The queue outcome is recorded in `index.ts` where `ack`/`retry` is decided; the cache hit in `cached()` **and** at the two `cacheGet` sites in `authMiddleware`, whose hit test is conditional (an unknown `kid`, a changed display name) and so cannot use the helper. Instrument the read, not the helper — a new `cacheGet` caller that skips this leaves a hit rate that quietly excludes it
- `METRICS` is optional and every function no-ops without it. That is the path the tests and local dev take, so it is the common case, not a degraded one

## Error Handling

- Use Hono's `onError` handler for global error catching
- Return consistent error JSON: `{ error: string, status: number }`
- Log errors but never expose internal details to the client

## Migrations

- Files named sequentially: `0001_create_children.sql`, `0002_create_feedings.sql`, etc.
- Each migration should be reversible when possible (include comments with rollback SQL)
- Applied automatically on deploy — `deploy-server.yml` runs `wrangler d1 migrations apply baby-tracker-db --remote` ahead of `wrangler deploy` on every push to main. It is idempotent (wrangler records which migrations have run), so merging the file is all that is needed; there is no manual step to remember or to tell anyone about.
- Locally: `npx wrangler d1 migrations apply <DB_NAME> --local`
- KV has its own runner, `scripts/kv-migrate.mjs`, run by the same workflow but *after* the upload rather than before it. Numbered `.mjs` files in `kv-migrations/` run once each; the version sweep runs every time and is never recorded. Also idempotent, also nothing to apply by hand. `npm run kv:migrate` for local, `npm run kv:status` to see what a remote run would do
