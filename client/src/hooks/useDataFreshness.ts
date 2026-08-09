import { useSyncExternalStore } from "react";
import { getStaleSince, subscribeFreshness } from "../api/freshness";

/**
 * When the data currently on screen was generated (local ms timestamp), or
 * `null` while it's coming straight from the server.
 *
 * Non-null means the service worker is serving its offline cache, so the app
 * is showing entries that may have been superseded by another caregiver's
 * phone. Surfaced by `Layout` as a banner.
 */
export function useDataFreshness(): { staleSince: number | null } {
  const staleSince = useSyncExternalStore(subscribeFreshness, getStaleSince, getStaleSince);
  return { staleSince };
}
