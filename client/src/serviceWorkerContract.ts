/**
 * Header a service worker stamps on replies it answered from its own cache
 * rather than the network.
 *
 * The current worker never sets it — it keeps no API cache at all (see
 * `sw.ts`) — but builds that did cache stamp it, and one of those workers
 * serves the single load it takes to upgrade off it. The client keeps
 * honouring the label (`freshness.ts`) until no installed device predates
 * this build.
 */
export const FROM_CACHE_HEADER = "X-From-Cache";
