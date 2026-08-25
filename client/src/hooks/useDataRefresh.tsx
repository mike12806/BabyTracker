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

/**
 * Ignore an automatic refresh this soon after the previous one (ms).
 *
 * Bringing the app back to the front does not fire one event, it fires a
 * burst: `visibilitychange` and `focus`, a `pageshow` if the page came out of
 * the back/forward cache, an `online` as the phone's radio re-attaches, and —
 * because iOS freezes a backgrounded page rather than running timers in it —
 * whichever poll ticks came due while it was away, all delivered at once on
 * resume. Every one of those is a legitimate "we are back, get current data"
 * signal on its own; together they used to mean the dashboard visibly rebuilt
 * itself two or three times in a row.
 *
 * Ten seconds rather than the couple this started as: on iOS the burst is not
 * tight. `focus` can trail `visibilitychange` by seconds when the phone was
 * unlocked with Face ID, and `online` lands whenever the radio finishes. What
 * it costs is bounded — the poll below still refetches every minute, and a
 * failed refresh still retries on its own cadence — so nothing on screen goes
 * more than the usual interval without being brought up to date.
 */
export const REFRESH_THROTTLE_MS = 10_000;

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

  const bumpRefreshKey = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Entries are often logged from another device (or the installed PWA sits in
  // the background for hours), so refetch whenever the app becomes visible
  // again — see `REFRESH_THROTTLE_MS` for why coming back fires more than one
  // of these at a time.
  const lastRefresh = useRef(0);
  const refreshHeld = useRef(false);

  /**
   * Refetch now, whatever else is going on.
   *
   * This is what the context hands out, so a save or the stale banner's Retry
   * button lands here: an explicit action is never throttled or held back. It
   * also stamps the clock the throttle below reads, so an automatic refresh
   * arriving right behind a save — the poll tick that was held while the
   * dialog was open, released the moment it closed — sees the data it wanted
   * has already been fetched and stands down.
   */
  const runRefresh = useCallback(() => {
    lastRefresh.current = Date.now();
    refreshHeld.current = false;
    bumpRefreshKey();
  }, [bumpRefreshKey]);

  /**
   * Refetch unless something says not to right now.
   *
   * Every automatic trigger goes through here — the visibility and focus
   * events, `online`, the foreground poll, the stale-retry ping — so that the
   * throttle is one shared gate rather than a check bolted onto whichever
   * trigger happened to be noticed first. That was the bug: the throttle sat
   * in the visibility handler alone, and the resume burst reached the page
   * through the paths that skipped it.
   *
   * On a phone the on-screen keyboard and the native date picker both blur and
   * re-focus the window, so a refresh can be triggered repeatedly while a form
   * is open. Refetching then rebuilds every list under the dialog for no
   * benefit, and a request that fails mid-form can bounce the whole app through
   * re-auth — taking the half-filled form with it. Hold it instead, and let any
   * later trigger pick it up once the form is closed.
   */
  const attemptRefresh = useCallback((options?: { ignoreThrottle?: boolean }) => {
    if (document.visibilityState !== "visible") return;
    // Deliberately ahead of the busy check: nothing is owed to the user here,
    // because a refresh this recent already fetched what this trigger wanted.
    // Holding it would only queue up a duplicate for the next release.
    if (!options?.ignoreThrottle && Date.now() - lastRefresh.current < REFRESH_THROTTLE_MS) return;
    if (isUserBusy()) {
      refreshHeld.current = true;
      return;
    }
    runRefresh();
  }, [runRefresh]);

  // The throttle exists to stop good data being re-fetched over itself, so
  // the paths where there is no good result to duplicate are exempt from it:
  // the two that recover a stale screen (the last refresh there failed), and
  // a flush that has just put new entries on the server.
  const isStaleRef = useRef(isStale);
  isStaleRef.current = isStale;

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
      // Past the throttle: entries just moved from this device's queue onto
      // the server, so this is not a duplicate of the refresh that ran when
      // the app came back — it is the one that drops their pending mark. The
      // `synced > 0` guard is what keeps it honest, and the single-flight
      // latch above means one flush asks once.
      if (summary.synced > 0) attemptRefreshRef.current({ ignoreThrottle: true });
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
    const onVisible = () => attemptRefreshRef.current();

    // Closing the dialog (or just leaving a field) is when a held-back refresh
    // becomes safe. `focusout` fires before focus lands, so re-check next tick.
    // Released through `attemptRefresh` rather than straight to `runRefresh`:
    // if a refresh has landed since the hold began there is nothing left to
    // release, and if the throttle does decline it the flag stays set for the
    // poll tick to pick up.
    const onFocusOut = () => {
      if (!refreshHeld.current) return;
      setTimeout(() => {
        if (refreshHeld.current && !isUserBusy()) attemptRefreshRef.current();
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
    //
    // iOS also fires this on resume when nothing was ever lost, which is why
    // the refetch is throttled like the rest unless the screen is actually
    // stale. The flush is not throttled with it: it is not a refetch, and if
    // it does send anything it asks for its own refresh.
    const onOnline = () => {
      void syncOutboxRef.current();
      attemptRefreshRef.current({ ignoreThrottle: isStaleRef.current });
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
        // Only armed while stale, and it has already paid for a ping that came
        // back healthy, so this is the refresh the banner promises rather than
        // a duplicate of one that worked.
        attemptRefreshRef.current({ ignoreThrottle: true });
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
    <DataRefreshContext.Provider value={{ refreshKey, refreshData: runRefresh }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  return useContext(DataRefreshContext);
}
