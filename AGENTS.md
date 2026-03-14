# BabyTracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy).

## Project Overview

Monorepo for a baby tracking application. Two packages:

- `client/` — React + Vite SPA deployed to Cloudflare Pages
- `server/` — Hono-based Cloudflare Worker API deployed to Cloudflare Workers, backed by Cloudflare D1

## Architecture

- **Client**: React + Vite SPA served from Cloudflare Pages. Communicates with the backend via REST API.
- **Server**: Single Cloudflare Worker using Hono as the router. Uses Cloudflare D1 (SQLite-compatible) for persistence.
- **Auth**: Cloudflare Access. Both the client (Pages) and server (Worker) are behind Cloudflare Access. The Worker validates the `Cf-Access-Jwt-Assertion` header, extracts the user's email, and auto-creates a user row on first request. No custom login UI or session management needed.
- **Database**: Cloudflare D1. Migrations live in `server/migrations/`. Use sequential numbered migration files.
- **Multi-tenancy**: Multiple users, each linked to one or more children via a junction table. Users are auto-created from the Cloudflare Access JWT email.

## Domain Model

Core entities modeled after Baby Buddy:

- **Child** — name, birth date
- **Feeding** — type (breast left/right, bottle, solid), start/end time, amount, notes
- **Diaper Change** — time, type (wet/solid/both), color, notes
- **Sleep** — start/end time, nap vs. night, notes
- **Tummy Time** — start/end time, milestone, notes
- **Pumping** — start/end time, amount, notes
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
- Always create reversible migrations when possible
- Use `INTEGER` for booleans (0/1) — D1 is SQLite-compatible
- Store timestamps as ISO 8601 text strings
- Every table includes `created_at` and `updated_at` columns
