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
 * Cloudflare Access's signing keys.
 *
 * Read what this number actually governs, because it is not freshness in the
 * usual sense. A *new* key is picked up in a single request — `signingKeyFor`
 * re-fetches the moment it sees a `kid` it does not recognise — so rotation
 * never waits on the TTL. What the TTL alone bounds is the opposite case: how
 * long a key that Cloudflare has **withdrawn** goes on being trusted here. If a
 * signing key were ever revoked as compromised, this is the window in which
 * this Worker would still accept tokens signed with it.
 *
 * Five minutes rather than an hour for that reason. The cost of the shorter
 * window is close to nothing — one extra fetch per five minutes per location,
 * for a small public document, against the many thousands of requests those
 * five minutes otherwise cover — and it is the only cached value here whose
 * staleness is a security question rather than a cosmetic one.
 */
export const JWKS_TTL_SECONDS = 300;

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
