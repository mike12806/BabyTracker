# Client — React + Vite + Material UI

## Stack

- React 18+ with TypeScript
- Vite for bundling and dev server
- Material UI (MUI) for all UI components
- Deployed to Cloudflare Pages

## Structure

- `src/components/` — Reusable UI components
- `src/pages/` — Top-level route pages
- `src/api/` — API client functions (fetch wrappers)
- `src/hooks/` — Custom React hooks
- `src/types/` — Shared TypeScript types
- `src/theme/` — MUI theme customization

## Conventions

- Use MUI components exclusively — do not mix in raw HTML elements for UI controls, inputs, or layout
- Use MUI's `sx` prop for one-off styling; use `styled()` or theme overrides for reusable styles
- Use React Router for client-side routing
- API calls go through a centralized client in `src/api/` — never call `fetch` directly from components
- Use ISO 8601 strings for all date/time values; format for display at the component level
- Prefer controlled components for forms
- Use `useQuery`/`useMutation` patterns (e.g., TanStack Query) for server state management

## Data Freshness

The app is installed as a PWA and left running for days, so anything on screen
is read as the current state of a baby — how long since the last feed, whether
she's been changed. Stale data is a correctness bug here, not a cosmetic one.

Priorities, in this order: **never show stale data, then cost, then
performance.** Decisions below follow from that ordering; don't trade upward.

- **API data is never cached. Anywhere.** The service worker (`src/sw.ts`,
  hand-written via `injectManifest`) has no route for `/api/*`; requests pass
  through and fail honestly when the network is down. The server sends
  `Cache-Control: no-store` so no HTTP cache answers either. Every scheme that
  kept an offline copy needed a second mechanism to label it, and each had
  windows where old data slipped through as current — keeping no copy is the
  only version with nothing to get wrong. Do not add a runtime cache for
  `/api/*` back, however tempting for offline support: readable-but-wrong lost
  to unavailable-but-honest by design.
- When the server is unreachable the app keeps its last-rendered data, raises
  the banner in `Layout` (driven by `freshness.ts` — `markOffline` on a failed
  request, cleared by the next success), and retries: `STALE_RETRY_MS` pings
  `pingServer` and refreshes only when the ping succeeds, so an outage costs
  one tiny request per cycle instead of a full failed refresh and its error
  toasts. An `online` event refreshes immediately.
- Every page that loads entries must key its fetch effect on `refreshKey` from
  `useDataRefresh`, alongside `selectedChild`. A `useEffect` with only
  `[selectedChild]` never refetches after mount and will go stale.
- `DataRefreshProvider` bumps `refreshKey` when the app is reopened
  (`visibilitychange`, `focus`, bfcache `pageshow`), on a foreground poll, and
  whenever an entry is saved. It holds refreshes back while a form is open —
  see `isUserBusy` — so nothing rebuilds under a half-filled dialog.
- `FOREGROUND_POLL_MS` is a freshness lever first. A Dashboard refresh is 12
  requests, five of them `limit=500`, so a device left open all day polls tens
  of millions of D1 rows a month — against the 25 billion rows/month the
  Workers Paid plan includes, and $0.001/million beyond it. Redo that maths
  before shortening it further, and note it would bite hard on the free plan.
- `FROM_CACHE_HEADER` handling in `freshness.ts` (and the clock-skew fallback
  under it) looks vestigial but is load-bearing during upgrades: a previous
  build's worker serves the one load it takes to replace it, and that worker
  can still answer from its old `api-cache`. The new worker deletes that cache
  on activate. Keep the header check until no installed device predates it.
- What *is* cached: the precached app shell (versioned per build) and Google
  Fonts. Neither is data, and neither can be stale in the data sense.
- The service worker's `/api/` cache is an offline fallback only: it must never
  pre-empt a working network. Don't reintroduce `networkTimeoutSeconds`.
- Anything served from that cache is flagged to the user by the banner in
  `Layout`, driven by `useDataFreshness` — the app never presents cached
  entries as if they were live.
- API responses are `Cache-Control: no-store` so no HTTP cache in between can
  answer on the server's behalf.

## Auth

- Cloudflare Access handles login — no login page or auth UI needed in the app
- The client and API are both behind Cloudflare Access, so the browser automatically has a valid CF Access cookie
- The API client includes credentials with every request (`credentials: 'include'`)
- On 401 responses, redirect the user to re-authenticate via Cloudflare Access
- A `/api/auth/me` endpoint returns the current user's profile (email, name)
- No logout button needed — session lifecycle is managed by Cloudflare Access

## Component Patterns

- Each page component corresponds to a route and composes smaller components
- Form components for each entity (FeedingForm, DiaperForm, SleepForm, etc.)
- Dashboard should show recent activity across all tracked entities
- Timer components for in-progress events (feedings, sleep, tummy time)
