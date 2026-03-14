# Server — Hono Cloudflare Worker + D1

## Stack

- Hono as the HTTP router
- Cloudflare D1 (SQLite) for persistence
- Cloudflare Access for auth
- Deployed as a single Cloudflare Worker

## Structure

- `src/index.ts` — Worker entry point, mounts route modules
- `src/routes/` — One file per resource (children, feedings, diapers, sleep, etc.)
- `src/middleware/` — Hono middleware (auth, error handling)
- `src/db/` — Database query helpers and types
- `src/types/` — Shared TypeScript types
- `migrations/` — D1 migration SQL files

## Conventions

- Every route file exports a `Hono` instance that gets mounted in `index.ts`
- All routes are prefixed with `/api/`
- Use Hono's `c.env.DB` to access the D1 binding
- Always use `c.req.valid()` with Zod or Hono's built-in validators for request validation
- Return JSON responses with `c.json()` — include appropriate HTTP status codes
- Use `c.var` for middleware-injected values (e.g., authenticated user email)

## Auth Middleware

- Validate `CF-Access-JWT-Assertion` header on every request
- Extract the user's email from the JWT payload
- Store the email in `c.set('userEmail', email)` for downstream route handlers
- Reject requests with missing or invalid tokens with 401

## D1 Patterns

- All queries use prepared statements: `c.env.DB.prepare(sql).bind(...params)`
- Use `.all()` for SELECT queries, `.run()` for INSERT/UPDATE/DELETE
- Never string-concatenate user input into SQL
- Wrap multi-table writes in D1 batch: `c.env.DB.batch([stmt1, stmt2])`
- Return `created_at` and `updated_at` in all responses

## Error Handling

- Use Hono's `onError` handler for global error catching
- Return consistent error JSON: `{ error: string, status: number }`
- Log errors but never expose internal details to the client

## Migrations

- Files named sequentially: `0001_create_children.sql`, `0002_create_feedings.sql`, etc.
- Each migration should be reversible when possible (include comments with rollback SQL)
- Apply with: `npx wrangler d1 migrations apply <DB_NAME>`
