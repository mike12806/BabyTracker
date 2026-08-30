import { useEffect } from "react";
import { connectLive } from "../api/live";
import { useChildren } from "../hooks/useChildren";

/**
 * Keeps the live socket pointed at whichever child is on screen.
 *
 * Renders nothing. It exists because the two halves of this feature sit on
 * opposite sides of the provider tree: `DataRefreshProvider` consumes the
 * nudges but is mounted *above* `ChildProvider`, so it cannot see which child
 * is selected. The socket itself is a module singleton in `api/live.ts`, which
 * both halves reach without either needing to be a parent of the other — this
 * component only has to say which child, and it has to be inside
 * `ChildProvider` to know.
 *
 * The server holds one Durable Object per child, so a socket is a subscription
 * to exactly one of them and switching children reconnects. That is cheap and
 * deliberate; what it does not cover is a change to a child nobody is
 * currently looking at — a new sibling added on another phone, or an alert
 * raised for the other child. Those arrive on the next backstop poll or the
 * next time the app is brought to the front, which is the same latency they
 * had before any of this existed.
 */
export function LiveConnection() {
  const { selectedChild } = useChildren();
  const childId = selectedChild?.id ?? null;

  useEffect(() => {
    connectLive(childId);
    // Deliberately not disconnecting on every change of `childId`:
    // `connectLive` swaps the socket over itself, and closing here first would
    // add a gap with no subscription for no benefit. The cleanup is for the
    // component actually going away.
  }, [childId]);

  useEffect(() => {
    return () => connectLive(null);
  }, []);

  return null;
}
