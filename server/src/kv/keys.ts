/**
 * Every key this Worker reads or writes in KV, built in one place.
 *
 * Two rules hold for all of them, and the rest of `src/kv` depends on both:
 *
 * 1. **Every key is namespaced by `KV_SCHEMA_VERSION`.** KV has no schema and
 *    no `ALTER TABLE`, so the only way to change the *shape* of a stored value
 *    is to stop reading the old one. Bumping the version does that for the
 *    whole namespace at once, atomically, at the instant the new Worker goes
 *    live — no delete sweep to race the deploy, and no window where a new
 *    Worker deserializes a value written by the old one. The stranded keys are
 *    then swept by a KV migration (see `kv-migrations/`), which is a tidy-up
 *    rather than a correctness step.
 * 2. **Nothing here is a source of truth.** Every value under these keys is
 *    derived from D1 (or, for the JWKS, from Cloudflare Access) and can be
 *    thrown away at any moment without losing anything. That is what lets
 *    `cache.ts` swallow every KV error instead of failing the request.
 *
 * The migration ledger is the deliberate exception to rule 1 — see
 * `MIGRATION_KEY_PREFIX` below.
 */

/**
 * Bump this when the *shape* of anything stored under these keys changes, and
 * add a `kv-migrations/` file to sweep the abandoned prefix. Do not bump it to
 * expire stale data — that is what TTLs are for.
 */
export const KV_SCHEMA_VERSION = 1;

/** Prefix every cache key carries, e.g. `v1:`. */
export const KV_PREFIX = `v${KV_SCHEMA_VERSION}:`;

/**
 * The migration ledger's prefix, deliberately *outside* `KV_PREFIX`.
 *
 * It records which migrations have run, so a schema bump that abandoned it
 * would re-run every migration ever written — including the sweeps whose whole
 * job is to clean up after that bump.
 */
export const MIGRATION_KEY_PREFIX = "__kv_migration:";

/** Metadata about the namespace itself, written by the initial migration. */
export const META_KEY = "__kv_meta";

/**
 * Cloudflare Access's JWT signing keys.
 *
 * One key for the whole account rather than one per team domain: the domain
 * comes from a `[vars]` entry that changes roughly never, and a stale entry
 * under a renamed domain would expire on its own within the hour.
 */
export function jwksKey(): string {
  return `${KV_PREFIX}access-jwks`;
}

/**
 * One caregiver's resolved `users` row, keyed by the email in their Access JWT.
 *
 * The email goes in verbatim rather than lowercased, because `users.email` is
 * a case-sensitive SQLite column: two casings are two rows in D1, and a cache
 * that folded them into one key would partition differently from the table it
 * is standing in for. Cloudflare Access hands out one casing in practice, so
 * this costs nothing — it just means the cache cannot be the thing that
 * invents a discrepancy.
 */
export function userKey(email: string): string {
  return `${KV_PREFIX}user:${email}`;
}

/** The AI-written boop line pool, both moods in one value. */
export function boopPoolKey(): string {
  return `${KV_PREFIX}boop-lines`;
}

/** One child's newest daily note, whatever date it carries. */
export function dailyNoteKey(childId: number): string {
  return `${KV_PREFIX}daily-note:${childId}`;
}
