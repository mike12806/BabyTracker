import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isUserBusy } from "../utils/interruptions";

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
 */
const FOREGROUND_POLL_MS = 60_000;

export function DataRefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshData = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Entries are often logged from another device (or the installed PWA sits in
  // the background for hours), so refetch whenever the app becomes visible
  // again. `visibilitychange` and `focus` both fire when returning to a tab,
  // hence the throttle.
  const lastFocusRefresh = useRef(0);
  const refreshHeld = useRef(false);
  useEffect(() => {
    const runRefresh = () => {
      lastFocusRefresh.current = Date.now();
      refreshHeld.current = false;
      refreshData();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFocusRefresh.current < FOCUS_REFRESH_THROTTLE_MS) return;
      // On a phone the on-screen keyboard and the native date picker both blur
      // and re-focus the window, so this fires repeatedly while a form is open.
      // Refetching then rebuilds every list under the dialog for no benefit,
      // and a request that fails mid-form can bounce the whole app through
      // re-auth — taking the half-filled form with it. Hold it until the form
      // is closed.
      if (isUserBusy()) {
        refreshHeld.current = true;
        return;
      }
      runRefresh();
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

    // Same guards as a re-focus refresh: skip while hidden (coming back fires
    // `visibilitychange`, which refetches anyway) and while a form is open.
    const onPoll = () => {
      if (document.visibilityState !== "visible") return;
      if (isUserBusy()) {
        refreshHeld.current = true;
        return;
      }
      runRefresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("focusout", onFocusOut);
    const pollTimer = setInterval(onPoll, FOREGROUND_POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("focusout", onFocusOut);
      clearInterval(pollTimer);
    };
  }, [refreshData]);

  return (
    <DataRefreshContext.Provider value={{ refreshKey, refreshData }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  return useContext(DataRefreshContext);
}
