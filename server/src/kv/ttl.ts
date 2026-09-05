/**
 * How long each cached value is allowed to be wrong for.
 *
 * Every one of these is a *backstop*, not the mechanism: each value is dropped
 * explicitly by whatever writes it (see `cacheDelete` callers), and the TTL is
 * what bounds the damage when that invalidation is missed — a KV delete that
 * has not propagated yet, a write that happened in another Worker, a row
 * changed by hand in the D1 console. So the question each number answers is
 * "how long could this be stale before someone is actually misled", not "how
 * fresh would be nice".
 */

/**
 * Cloudflare Access's signing keys. Access publishes the next key well before
 * it starts signing with it, and `verifyJwt` re-fetches immediately on an
 * unknown `kid` anyway, so a rotation is picked up in one request rather than
 * one hour — this only bounds how long a *withdrawn* key stays trusted.
 */
export const JWKS_TTL_SECONDS = 3600;

/**
 * A caregiver's `users` row. Short, because it is the one cached value keyed to
 * a person: it stands in for a row that could be edited or removed out of band,
 * and five minutes of a stale display name is the worst it can cost. The name
 * from the JWT is compared on every request regardless, so a renamed account
 * refreshes at once rather than waiting this out.
 */
export const USER_TTL_SECONDS = 300;

/**
 * The boop line pool. Written weekly by a cron and read once per session; the
 * lines are decoration, so an hour behind is not a state anyone can notice.
 */
export const BOOP_POOL_TTL_SECONDS = 3600;

/**
 * A child's daily note. Written once a day by the cron (twice, counting the
 * template the AI version replaces), and the refresh route and the queue
 * consumer both drop the key as they write. An hour is the ceiling on how long
 * a note nobody invalidated could linger.
 */
export const DAILY_NOTE_TTL_SECONDS = 3600;
