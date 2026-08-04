import { isUserBusy } from "./interruptions";

/**
 * A background stint at least this long means the user walked away, so coming
 * back is a natural moment to start on the new build.
 */
export const STALE_BACKGROUND_MS = 30 * 60 * 1000;

export interface DeferredReload {
  /** A new build is ready — reload at the next moment that won't cost the user anything. */
  request: () => void;
  /** Detach listeners. */
  dispose: () => void;
}

/**
 * Holds a page reload until it's safe to perform.
 *
 * "Safe" means nothing is open that a reload would destroy, and the app isn't
 * in front of the user: either it's been backgrounded, or it's just come back
 * from a long stint in the background where a fresh start is expected anyway.
 */
export function createDeferredReload(reload: () => void): DeferredReload {
  let requested = false;
  let hiddenAt = 0;

  const attempt = () => {
    if (!requested) return;
    if (isUserBusy()) return;

    const backgrounded = document.visibilityState === "hidden";
    const returningFromLongAbsence = hiddenAt > 0 && Date.now() - hiddenAt >= STALE_BACKGROUND_MS;
    if (!backgrounded && !returningFromLongAbsence) return;

    requested = false;
    reload();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      attempt();
      return;
    }
    attempt();
    hiddenAt = 0;
  };

  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    request: () => {
      requested = true;
      attempt();
    },
    dispose: () => document.removeEventListener("visibilitychange", onVisibilityChange),
  };
}
