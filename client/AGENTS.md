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
  (`visibilitychange`, `focus`, bfcache `pageshow`), on a live nudge, on a
  poll, and whenever an entry is saved. It holds refreshes back while a form is
  open — see `isUserBusy` — so nothing rebuilds under a half-filled dialog.
- **The live socket replaces one trigger, not the machinery.** `api/live.ts`
  holds one WebSocket per tab, pointed at the selected child by
  `components/LiveConnection.tsx`, and what arrives on it is a nudge with no
  entry data in it — the app still fetches over `/api/*`, so the no-cache rule
  above is unaffected. Everything else here is unchanged and still needed: the
  page is frozen on an installed PWA, so the socket is usually dead by the time
  it thaws and the resume handlers are what notice. A change published while
  the socket was down reached nobody and is never re-sent, which is why
  reconnecting after a gap longer than `REFRESH_THROTTLE_MS` refetches.
- **A nudge is not subject to `REFRESH_THROTTLE_MS`.** That throttle suppresses
  duplicate refreshes of data nobody touched; a nudge is the server stating
  that something *was* touched, so putting it behind the throttle would
  silently drop the second of two entries logged seconds apart — the exact case
  the socket exists for. `LIVE_COALESCE_MS` collapses bursts instead. A nudge
  held by an open form re-checks itself every `LIVE_HELD_RECHECK_MS` rather
  than waiting on `focusout`, which a backdrop-dismissed dialog never fires.
- **The poll stays, slower.** `LIVE_BACKSTOP_POLL_MS` (5 min) while the socket
  is delivering, `FOREGROUND_POLL_MS` (1 min) whenever it is not. Do not delete
  the poll: a socket that has quietly stopped delivering looks exactly like a
  household where nobody has logged anything, and the ordering at the top of
  this section puts never showing stale data above both cost and performance.
  The 45s heartbeat in `api/live.ts` is the fast detector; the poll is the slow
  one underneath it.
- **A socket that will not open is a supported state.** A browser is never told
  why an upgrade failed — the WebSocket API hides the HTTP status — so an
  Access policy that rejects upgrades, a proxy that strips them and a dead
  network are indistinguishable from the client. After `COLD_ATTEMPT_LIMIT`
  attempts that never reached the server's greeting, the app stops trying and
  goes back to the 1-minute poll, re-probing when it is next brought to the
  front. Nothing else changes; only latency does.
- `FOREGROUND_POLL_MS` is a freshness lever first. A Dashboard refresh is 12
  requests, five of them `limit=500`, so a device left open all day polls tens
  of millions of D1 rows a month — against the 25 billion rows/month the
  Workers Paid plan includes, and $0.001/million beyond it. Redo that maths
  before shortening it further, and note it would bite hard on the free plan.
  With the socket up this is the fallback rather than the main path, so the
  figure above is now a ceiling reached only when live updates are unavailable.
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
- **A backgrounded PWA's WebSocket dies, usually silently.** iOS freezes the
  page rather than closing it, so timers do not run and `onclose` often never
  fires — the socket has to be probed (`revalidateLive`) on resume rather than
  waited on. This is why the live socket lives in the page and not in the
  service worker, which on iOS is shorter-lived still. WebSockets themselves
  work fine in an installed PWA; it is the backgrounding that ends them.

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

## Alerts feed

The bell in the app bar (`AlertsBell.tsx`, `api/alerts.ts`) reads back the
alerts the server decided to raise — overdue diaper/feeding reminders and
feeding-trend alerts. It is the app's own copy of what push delivers, and it
exists because push here is the unreliable half: a notification swiped off a
lock screen is gone while what it reported is still true, it only ever reached
the devices that opted in, and on an installed iOS PWA — most of the installs
here — it is the least dependable link in the chain.

- **It renders, it does not decide.** The sentence in a row is the one the
  server sent, stored as sent. A trend alert's figures describe the moment it
  was raised, so recomputing them against the current clock would have the app
  saying something the alert never said.
- **The feed is not cached**, like every other read here. It refetches on
  `refreshKey` with everything else, and a closed drawer holds whatever the
  last fetch returned.
- **`getOptional`/`postOptional`.** Nobody opened the app to read the bell, so
  neither the fetch nor the read-mark may raise the stale-data banner or arm
  the retry loop — same reasoning as the daily note. A fetch that fails costs
  the badge its number rather than claiming one it can't stand behind.
- **Read is marked to the newest row that was on screen**, never to `now`: an
  alert raised between the fetch and the tap would otherwise be cleared
  without ever having been seen. The server only ever moves the mark forward,
  so a second device with a stale drawer can't un-read anything.
- **The bell is a toggle.** `Layout`'s app bar sits at `zIndex.drawer + 1`, so
  it stays above the drawer's backdrop and the bell goes on receiving taps
  while the drawer is open — the backdrop never sees them, which is why a
  second tap has to close the drawer itself rather than relying on the
  click-away. Anything else put in the app bar alongside it inherits the same
  situation.
- **Dismissing is optimistic, per-user, and undoable.** The row leaves the
  list on the tap and goes back if the server won't take it — what must never
  happen is a screen showing a dismissal that was never recorded, so that
  path reports the failure rather than swallowing it. The undo is rendered
  *inside* the drawer rather than as a `Snackbar`: an open MUI Drawer is a
  modal and marks everything outside it `aria-hidden`, so a portalled
  snackbar would be invisible to a screen reader for exactly as long as it
  was on offer. It has no timer either — this app is used one-handed, and an
  undo that expires while you are holding a baby is not an undo.

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
