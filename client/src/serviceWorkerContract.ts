/**
 * The handful of names the app and its service worker have to agree on.
 *
 * Kept in its own module because both sides import it: `sw.ts` is bundled
 * separately from the app, so anything shared through a larger module would
 * drag that module's contents into the worker bundle.
 */

/**
 * Header the service worker stamps on replies it answered from its own cache
 * rather than the network.
 *
 * This is what lets the app state, rather than infer, that what's on screen is
 * a saved copy — see `sw.ts` for why inferring it from timestamps isn't good
 * enough.
 */
export const FROM_CACHE_HEADER = "X-From-Cache";
