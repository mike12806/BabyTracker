import type { Alert } from "../types/models";

/**
 * Taking an answered reminder back off the lock screen.
 *
 * A push is a copy of an alert that lives on the device rather than on the
 * server, so nothing the server does can retract it — clear the alert in the
 * database and the notification is still sitting there, saying nobody has fed
 * her, above a home screen where somebody just did. Only the page or the
 * service worker can close it, so the app closes it itself.
 *
 * The rule is deliberately not "close what I just logged": it is *the
 * notifications on this device that no longer name an open alert get closed*.
 * That falls out of the feed the bell already fetches, and it costs nothing to
 * be right about the cases a narrower rule gets wrong — the other parent's
 * phone, still showing a reminder for a feed logged on this one; a reminder
 * answered while the app was closed; an alert dismissed from the drawer.
 *
 * The identity is the notification `tag`, which the server sets from
 * `reminderNotificationTag` in `server/src/scheduled/reminders.ts`; the same
 * string is rebuilt here from the feed. Only reminder tags are touched.
 * Anything else on the screen — a feeding-trend alert, a notification from a
 * build before this existed — is left where it is, because this can only tell
 * that a notification has been answered for the ones it can match to an alert.
 */

/** Prefix every reminder notification's tag carries. */
export const REMINDER_TAG_PREFIX = "reminder:";

/** The kinds of alert that a later entry can answer. */
const ANSWERABLE_KINDS = new Set<Alert["kind"]>(["diaper", "feeding"]);

/** Must match `reminderNotificationTag` on the server, exactly. */
export function reminderTag(childId: number, kind: "diaper" | "feeding"): string {
  return `${REMINDER_TAG_PREFIX}${childId}:${kind}`;
}

/**
 * Close every reminder notification on this device that the given feed no
 * longer accounts for.
 *
 * Call it only with a feed that actually came back from the server: an empty
 * list because the request failed is not evidence that anything was answered,
 * and acting on it would clear a reminder that is still true.
 *
 * Silent on every browser that can't do this — no service worker, an iOS
 * Safari tab that was never installed, a permissions state where
 * `getNotifications` throws. Tidying the lock screen is the last thing the
 * app is for, so it never reports a failure and never blocks its caller.
 */
export async function closeAnsweredReminderNotifications(alerts: Alert[]): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // `getRegistration`, not `ready`: `ready` never settles when no worker is
    // registered at all (a dev server, a browser that declined it), and this
    // is called on every refresh.
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || typeof registration.getNotifications !== "function") return;

    const open = await registration.getNotifications();
    if (open.length === 0) return;

    const stillOpen = new Set(
      alerts
        .filter((alert) => ANSWERABLE_KINDS.has(alert.kind))
        .map((alert) => reminderTag(alert.child_id, alert.kind as "diaper" | "feeding")),
    );

    for (const notification of open) {
      if (notification.tag?.startsWith(REMINDER_TAG_PREFIX) && !stillOpen.has(notification.tag)) {
        notification.close();
      }
    }
  } catch {
    // Nothing to recover from and nothing worth telling anyone: the alert
    // itself is already off the bell, which is the half that matters.
  }
}
