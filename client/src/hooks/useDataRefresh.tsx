import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusRefresh.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefresh.current = now;
      refreshData();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
