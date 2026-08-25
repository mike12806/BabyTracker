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
- That rule is about the *server's answers*. It is not about the user's own
  unsent writes, which are kept — see **Offline writes** below. The two are
  opposites: a stored copy of a server reply is a claim about the baby that may
  since have become false, while a queued write is a fact about what this user
  did that no unreachable server can contradict.
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
- API responses are `Cache-Control: no-store` so no HTTP cache in between can
  answer on the server's behalf.

## Offline Writes

Reads keep nothing; writes keep everything. A create that cannot reach the
server goes into a durable queue on the device (`src/api/outbox.ts`) and is
sent on the next signal that the server is back. Losing what someone typed
because the radio was down is not honesty, it is data loss.

- **Only creates are queued.** An edit or a delete offline is an operation on a
  row the server owns, and that row may have been changed by the other
  caregiver in the meantime — replaying it later overwrites work this device
  never saw, with nothing to detect it by. A failed edit stays a failed edit.
  Timers are excluded too: a running timer means "started now", so one started
  offline and flushed hours later would be a lie.
- **Safety is the idempotency key, not the queue.** Every queued create carries
  the `client_request_id` `useSaveGuard` gave it at the moment Save was pressed
  (see `server/src/routes/idempotency.ts`). That is what makes a flush safe to
  repeat from any tab against a server that may already have applied it — the
  replay is answered with the original row. Never strip or regenerate that key
  on the way out of the queue.
- **Queued entries appear in the lists, marked.** They are merged in by
  `mergePending` and rendered with `PendingChip`; `PendingSyncBanner` counts
  them at the top of every page. Showing them is required — the dashboard
  answers "when did she last eat", and an entry logged ten minutes ago is part
  of that answer. Marking them is equally required: until it lands, nobody
  else's phone can see it. A pending row keeps a **negative `id`**, which is
  the whole test (`isPending`) for "never reached the server" — it is what
  stops an `?edit=` link or a `DELETE /api/…/-1`.
- **What is retried and what is not.** A failure with no status (dropped
  connection, request deadline) or a 5xx/429 is held and retried; an expired
  session is queued too, because re-auth navigates the open form away. A 4xx is
  not: the same payload will be rejected the same way, so the entry is set
  aside with the server's own message for the user to fix or discard. Entries
  are never dropped silently — only the user discards one.
- **Flush triggers** live in `DataRefreshProvider`: `online`, becoming visible,
  a successful stale-data ping, app launch, and `OUTBOX_RETRY_MS` as a
  backstop. A flush stops at the first entry the server won't take, so a tick
  during an outage costs one request rather than one per entry.

### PWA limits this design is shaped by

- **No Background Sync on iOS Safari**, which is most of the installs here, and
  a service worker cannot read `localStorage` anyway. The queue therefore
  drains from the foreground only. Do not assume an entry goes out while the
  app is closed — it doesn't, and the banner is what makes that visible.
- **iOS evicts a backgrounded PWA whenever it likes**, so the queue must be on
  disk (it is) and a flush must be resumable from nothing — no in-progress
  state that only exists in memory.
- **Storage can refuse a write** (quota, private browsing). `enqueue` returns
  null there and the save is reported as failed, because telling someone their
  entry is safe on the device when nothing recorded it is worse than an error.
- **Two tabs share one queue.** Concurrent flushes are safe (the key
  deduplicates), and a `storage` listener keeps the other tab's rendering from
  going stale.

### Conflicts on reconnect

Between a queued create and the server there are none worth resolving: an
entry that did not exist cannot have been concurrently edited, every entity is
ordered by a client-supplied timestamp so a backdated entry lands where it
belongs, and the idempotency key rules out duplicating the entry itself. The
one real conflict is two caregivers logging the *same real-world event* from
different devices, which produces two rows. That is not an offline problem —
it happens with both devices online — and it is deliberately not auto-merged:
the app cannot tell "logged twice" from "fed twice", and deleting a real
second feed is worse than showing two rows the user can delete.

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
