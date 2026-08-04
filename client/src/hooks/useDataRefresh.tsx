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

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("focusout", onFocusOut);
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
