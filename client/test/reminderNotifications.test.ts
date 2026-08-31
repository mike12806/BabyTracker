/**
 * Taking an answered reminder off the lock screen.
 *
 * The rule under test is "close what the feed no longer accounts for", not
 * "close what I just logged" — so the cases that matter are the ones a
 * narrower rule gets wrong: a reminder still standing must survive, and
 * notifications this app can't identify must be left alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeAnsweredReminderNotifications, reminderTag } from "../src/utils/reminderNotifications";
import type { Alert } from "../src/types/models";

function alert(kind: Alert["kind"], childId: number): Alert {
  return {
    id: childId,
    child_id: childId,
    kind,
    title: "Feeding reminder",
    body: "No feeding logged for Mikey in over 2 hours 45 minutes.",
    url: "/",
    created_at: "2026-08-20T10:00:00Z",
    child_first_name: "Mikey",
  };
}

/** A displayed notification, with the `close` the browser would give it. */
function shown(tag: string | undefined) {
  return { tag, close: vi.fn() };
}

function mockServiceWorker(notifications: ReturnType<typeof shown>[]) {
  const getRegistration = vi.fn(async () => ({
    getNotifications: vi.fn(async () => notifications),
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration },
    configurable: true,
    writable: true,
  });
  return getRegistration;
}

describe("closeAnsweredReminderNotifications", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("closes a reminder the feed no longer carries", async () => {
    const answered = shown(reminderTag(1, "feeding"));
    mockServiceWorker([answered]);

    // The feed still has the diaper reminder, but nothing for feeding — a
    // feed has been logged since it was raised.
    await closeAnsweredReminderNotifications([alert("diaper", 1)]);

    expect(answered.close).toHaveBeenCalled();
  });

  it("leaves a reminder that is still outstanding", async () => {
    const standing = shown(reminderTag(1, "feeding"));
    mockServiceWorker([standing]);

    await closeAnsweredReminderNotifications([alert("feeding", 1)]);

    expect(standing.close).not.toHaveBeenCalled();
  });

  it("is per child — one baby's feed does not clear the other's reminder", async () => {
    const otherChild = shown(reminderTag(2, "feeding"));
    mockServiceWorker([otherChild]);

    await closeAnsweredReminderNotifications([alert("feeding", 2)]);

    expect(otherChild.close).not.toHaveBeenCalled();
  });

  it("leaves alone anything it cannot match to an alert", async () => {
    // A feeding-trend alert (untagged), and a reminder from a build before
    // tags existed. Absence from the feed says nothing about either.
    const untagged = shown(undefined);
    mockServiceWorker([untagged]);

    await closeAnsweredReminderNotifications([]);

    expect(untagged.close).not.toHaveBeenCalled();
  });

  it("does nothing on a browser with no service worker", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    await expect(closeAnsweredReminderNotifications([])).resolves.toBeUndefined();
  });

  it("swallows a browser that refuses to list notifications", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn(async () => ({
          getNotifications: vi.fn(async () => {
            throw new Error("not allowed");
          }),
        })),
      },
      configurable: true,
      writable: true,
    });

    // Tidying the lock screen is the last thing the app is for: the alert is
    // already off the bell, which is the half that matters.
    await expect(closeAnsweredReminderNotifications([])).resolves.toBeUndefined();
  });
});
