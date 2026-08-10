import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { pingServer } from "../api/client";
import { isUserBusy } from "../utils/interruptions";
import { useDataFreshness } from "./useDataFreshness";

interface DataRefreshContextType {
  /** Bumped whenever tracked data changes — use as a `useEffect` dependency to refetch. */
  refreshKey: number;
  /** Signal that entries changed and any mounted view should refetch. */
  refreshData: () => void;
}

const DataRefreshContext = createContext<DataRefreshContextType>({
  refreshKey: 0,
  refreshData: () => {},
});

/** Ignore a re-focus refresh this soon after the previous one (ms). */
const FOCUS_REFRESH_THROTTLE_MS = 2000;

/**
 * How often to refetch while the app is open and in front of the user (ms).
 *
 * Visibility events only fire when you leave and come back, so an app left
 * open — the tablet propped on the changing table, a desktop tab that stays
 * on the dashboard all afternoon — would otherwise show whatever was true
 * when it was opened, with nothing on screen hinting the numbers have moved.
 *
 * One minute, sized against the Workers Paid plan this runs on. A Dashboard
 * refresh is 12 requests, five of them `limit=500`, so a device left open all
 * day polls on the order of 40M D1 rows a month. The paid plan includes 25
 * billion rows read per month, so that is well under a tenth of a percent of
 * the allowance — and overage, if it were ever reached, is $0.001 per million
 * rows. The interval is not the cost lever it would be on the free plan, so it
 * is set for how current the numbers need to look instead.
 */
export const FOREGROUND_POLL_MS = 60_000;

/**
 * How often to check for the server coming back while the screen is stale (ms).
 *
 * An installed PWA is often launched or foregrounded before the phone's radio
 * has finished reconnecting, so the first refresh of a session routinely
 * fails. Without this the app would sit on the failed state until the next
 * ordinary poll — which is exactly the "opened it and it was out of date"
 * case. Each tick is a single `pingServer` request, and the full refresh runs
 * only once the ping succeeds; only armed while stale, so it costs nothing in
 * the normal case.
 */
export const STALE_RETRY_MS = 15_000;

export function DataRefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { staleSince } = useDataFreshness();
  const isStale = staleSince !== null;

  const refreshData = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Entries are often logged from another device (or the installed PWA sits in
  // the background for hours), so refetch whenever the app becomes visible
  // again. `visibilitychange` and `focus` both fire when returning to a tab,
  // hence the throttle.
  const lastFocusRefresh = useRef(0);
  const refreshHeld = useRef(false);

  const runRefresh = useCallback(() => {
    lastFocusRefresh.current = Date.now();
    refreshHeld.current = false;
    refreshData();
  }, [refreshData]);

  /**
   * Refetch unless something says not to right now.
   *
   * On a phone the on-screen keyboard and the native date picker both blur and
   * re-focus the window, so a refresh can be triggered repeatedly while a form
   * is open. Refetching then rebuilds every list under the dialog for no
   * benefit, and a request that fails mid-form can bounce the whole app through
   * re-auth — taking the half-filled form with it. Hold it instead, and let any
   * later trigger pick it up once the form is closed.
   */
  const attemptRefresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (isUserBusy()) {
      refreshHeld.current = true;
      return;
    }
    runRefresh();
  }, [runRefresh]);

  // Kept in a ref so the timer effects below can re-read the latest callback
  // without tearing down and rebuilding their intervals on every render.
  const attemptRefreshRef = useRef(attemptRefresh);
  attemptRefreshRef.current = attemptRefresh;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFocusRefresh.current < FOCUS_REFRESH_THROTTLE_MS) return;
      attemptRefreshRef.current();
    };

    // Closing the dialog (or just leaving a field) is when a held-back refresh
    // becomes safe. `focusout` fires before focus lands, so re-check next tick.
    const onFocusOut = () => {
      if (!refreshHeld.current) return;
      setTimeout(() => {
        if (refreshHeld.current && !isUserBusy()) runRefresh();
      }, 0);
    };

    // Restoring from the back/forward cache hands back the page exactly as it
    // was — React state, rendered lists and all — without remounting anything,
    // so a bfcache restore has to be treated as a return to the app.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onVisible();
    };

    // Connectivity coming back is the one moment we know the cached data on
    // screen can be replaced with the real thing, so don't wait for a tick.
    const onOnline = () => attemptRefreshRef.current();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    document.addEventListener("focusout", onFocusOut);
    // Doubles as the backstop for a held refresh: `focusout` is the responsive
    // release, but it doesn't always fire — a dialog dismissed by tapping the
    // backdrop with nothing focused inside it fires none — so the tick picks up
    // whatever it missed.
    const pollTimer = setInterval(() => attemptRefreshRef.current(), FOREGROUND_POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("focusout", onFocusOut);
      clearInterval(pollTimer);
    };
  }, [runRefresh]);

  // A stale screen is a state to get out of, not one to wait out. Ping first,
  // refresh only when it succeeds: refreshing into a dead network means every
  // mounted page refetching, failing, and toasting an error each cycle,
  // whereas a failed ping costs one request and no noise. Disarms itself as
  // soon as a refresh lands and clears the flag.
  useEffect(() => {
    if (!isStale) return;
    let cancelled = false;
    const retryTimer = setInterval(() => {
      void pingServer().then((reachable) => {
        if (!cancelled && reachable) attemptRefreshRef.current();
      });
    }, STALE_RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, [isStale]);

  return (
    <DataRefreshContext.Provider value={{ refreshKey, refreshData }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  return useContext(DataRefreshContext);
}
