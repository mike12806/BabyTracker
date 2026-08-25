import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { pingServer } from "../api/client";
import { flushOutbox } from "../api/outbox";
import { isUserBusy } from "../utils/interruptions";
import { useDataFreshness } from "./useDataFreshness";
import { useOutbox } from "./useOutbox";

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

/**
 * How often to try sending queued entries again while any are waiting (ms).
 *
 * A flush stops at the first entry the server won't take, so a tick during an
 * outage costs one request — the same as the stale-data ping above, and for
 * the same reason: find out cheaply, and do the real work only once it will
 * land. Longer than that ping because the two overlap during an outage and
 * nothing here is on screen waiting; entries also flush immediately on every
 * signal that the server is back, so this interval is the backstop, not the
 * main path.
 */
export const OUTBOX_RETRY_MS = 30_000;

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

  /**
   * Send anything logged on this device while the server was unreachable.
   *
   * Deliberately not gated on `isUserBusy`: a flush changes nothing on screen
   * by itself, so there is no half-filled form to protect, and holding the
   * queue back while someone types the *next* entry is exactly backwards. The
   * refetch afterwards does go through `attemptRefresh`, which is where that
   * guard belongs — that is the part that would rebuild lists under a dialog.
   */
  const flushing = useRef(false);
  const syncOutbox = useCallback(async () => {
    // `flushOutbox` is single-flight and hands every caller the same promise,
    // so without this the two or three triggers that fire together when an app
    // is foregrounded would each see the same "synced 3" and each ask for a
    // refetch of everything.
    if (flushing.current) return;
    flushing.current = true;
    try {
      const summary = await flushOutbox();
      if (summary.synced > 0) attemptRefreshRef.current();
    } finally {
      flushing.current = false;
    }
  }, []);

  const syncOutboxRef = useRef(syncOutbox);
  syncOutboxRef.current = syncOutbox;

  // Only the entries still in the running: one set aside for the user to deal
  // with must not keep the retry timer below armed forever. A boolean rather
  // than the count, so draining the queue one entry at a time doesn't tear the
  // timer below down and rebuild it after every single send.
  const hasQueuedEntries = useOutbox().some((entry) => !entry.failure);

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
    // Queued entries go out on the same signal, and go out *first*: sending
    // them before the refetch is what stops the reply arriving without the
    // feed that was logged in the dead zone and briefly contradicting it.
    const onOnline = () => {
      void syncOutboxRef.current();
      attemptRefreshRef.current();
    };

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
      // A hidden tab is not waiting on anything, and `attemptRefresh` would
      // decline to refresh anyway — so the ping would be a request asked purely
      // to have its answer thrown away, every 15s, for as long as the tab sits
      // in the background. Returning to it fires `visibilitychange`, which
      // refreshes directly.
      if (document.visibilityState !== "visible") return;
      void pingServer().then((reachable) => {
        if (cancelled || !reachable) return;
        // The ping just proved the server is back, which makes this the first
        // moment the queue can drain — and a queued entry is more urgent than
        // a refetch, since until it lands nobody else can see it.
        void syncOutboxRef.current();
        attemptRefreshRef.current();
      });
    }, STALE_RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, [isStale]);

  // Entries can outlive the session that queued them — the app may have been
  // evicted, or the phone simply put down — so a launch with anything waiting
  // tries immediately rather than sitting on it until the first timer tick.
  // Also covers the case the events above miss entirely: a connection that
  // came back without `online` ever firing, which is routine on iOS.
  const triedOnLaunch = useRef(false);
  useEffect(() => {
    if (!hasQueuedEntries) return;
    let cancelled = false;

    const attempt = () => {
      // Same reasoning as the stale-data loop: a hidden tab has nobody waiting
      // on it, and a flush there would be a doomed request every tick for as
      // long as it sits in the background. Foregrounding it fires
      // `visibilitychange`, and the handler below flushes straight away.
      if (document.visibilityState !== "visible") return;
      if (cancelled) return;
      void syncOutboxRef.current();
    };

    // Once per session, not every time the queue goes from empty to occupied:
    // an entry lands in here because its POST just failed, and trying the same
    // thing again a millisecond later is a request thrown away. A launch that
    // finds a queue already waiting is the case worth being eager about.
    if (!triedOnLaunch.current) {
      triedOnLaunch.current = true;
      attempt();
    }

    const onVisible = () => attempt();
    document.addEventListener("visibilitychange", onVisible);
    const retryTimer = setInterval(attempt, OUTBOX_RETRY_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(retryTimer);
    };
  }, [hasQueuedEntries]);

  return (
    <DataRefreshContext.Provider value={{ refreshKey, refreshData }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  return useContext(DataRefreshContext);
}
