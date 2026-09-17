/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { dispatch, emit, EVENTS_QUEUE } from "../src/events/bus.js";
import { entryEvent } from "../src/events/types.js";
import type { DomainEvent } from "../src/events/types.js";
import { SUBSCRIBERS } from "../src/events/subscribers.js";
import { applyMigrations, createTestApp, testRequest } from "./helpers";
import type { Env } from "../src/types/env.js";
import wranglerConfig from "../wrangler.toml?raw";

/** A queue binding that records what was published instead of sending it. */
function fakeQueue() {
  const sent: DomainEvent[] = [];
  return {
    sent,
    binding: {
      send: vi.fn(async (body: DomainEvent) => {
        sent.push(body);
      }),
      sendBatch: vi.fn(),
    },
  };
}

const anEvent = (over: Partial<DomainEvent> = {}): DomainEvent => ({
  ...entryEvent("entry.created", {
    childId: 1,
    table: "feedings",
    entryId: 10,
    actorUserId: 1,
  }),
  ...over,
});

describe("events/bus", () => {
  describe("emit", () => {
    it("publishes to the queue when one is bound", async () => {
      const queue = fakeQueue();

      await emit({ ...env, EVENTS: queue.binding } as unknown as Env, anEvent());

      expect(queue.sent).toHaveLength(1);
      expect(queue.sent[0].type).toBe("entry.created");
      expect(queue.sent[0].table).toBe("feedings");
    });

    // The fallback that keeps this change invisible to the tests and to local
    // dev: with no queue the subscribers run right there, which is exactly
    // what the write paths did before the bus existed.
    it("dispatches inline when no queue is bound", async () => {
      await applyMigrations(env.DB);
      const ran: string[] = [];
      const spy = vi
        .spyOn(SUBSCRIBERS[0], "handle")
        .mockImplementation(async () => void ran.push("ran"));

      await emit({ ...env, EVENTS: undefined } as unknown as Env, anEvent());

      expect(ran).toEqual(["ran"]);
      spy.mockRestore();
    });

    it("never throws when the queue does, because a stale bell is not a lost entry", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = {
        ...env,
        EVENTS: {
          send: async () => {
            throw new Error("Queues is having a bad minute");
          },
          sendBatch: vi.fn(),
        },
      } as unknown as Env;

      await expect(emit(broken, anEvent())).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("keeps the publish off the response path when given waitUntil", async () => {
      const queue = fakeQueue();
      const kept: Promise<unknown>[] = [];

      await emit(
        { ...env, EVENTS: queue.binding } as unknown as Env,
        anEvent(),
        (p) => kept.push(p),
      );

      // Handed over rather than awaited — the caller paid nothing for it.
      expect(kept).toHaveLength(1);
      await Promise.all(kept);
      expect(queue.sent).toHaveLength(1);
    });
  });

  describe("dispatch", () => {
    it("runs a subscriber that cares and skips one that does not", async () => {
      const calls: string[] = [];
      const subscribers = [
        { name: "yes", handles: () => true, handle: async () => void calls.push("yes") },
        { name: "no", handles: () => false, handle: async () => void calls.push("no") },
      ];
      const spy = vi.spyOn(SUBSCRIBERS, "filter").mockImplementation((fn) =>
        subscribers.filter(fn as never),
      );

      await dispatch(env as unknown as Env, anEvent());

      expect(calls).toEqual(["yes"]);
      spy.mockRestore();
    });

    it("isolates a failing subscriber so the others still run", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const calls: string[] = [];
      const subscribers = [
        {
          name: "throws",
          handles: () => true,
          handle: async () => {
            throw new Error("nope");
          },
        },
        { name: "after", handles: () => true, handle: async () => void calls.push("after") },
      ];
      const spy = vi.spyOn(SUBSCRIBERS, "filter").mockImplementation((fn) =>
        subscribers.filter(fn as never),
      );

      // The one that threw must not cost the one behind it its turn...
      await expect(dispatch(env as unknown as Env, anEvent())).rejects.toThrow(/throws/);
      expect(calls).toEqual(["after"]);

      spy.mockRestore();
      consoleError.mockRestore();
    });

    it("rethrows so the consumer retries the message", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const spy = vi.spyOn(SUBSCRIBERS, "filter").mockImplementation(() => [
        {
          name: "throws",
          handles: () => true,
          handle: async () => {
            throw new Error("nope");
          },
        },
      ] as never);

      await expect(dispatch(env as unknown as Env, anEvent())).rejects.toThrow(
        /1 subscriber\(s\) failed/,
      );

      spy.mockRestore();
      consoleError.mockRestore();
    });

    it("does nothing at all for an event nobody subscribes to", async () => {
      await expect(
        dispatch(env as unknown as Env, anEvent({ table: "notes" })),
      ).resolves.toBeUndefined();
    });
  });

  // The mapping that moved off the route config and onto the subscriber.
  describe("the reminder-resolution subscriber", () => {
    const subscriber = SUBSCRIBERS.find((s) => s.name === "reminder-resolution")!;

    it("exists, since the create path no longer clears reminders itself", () => {
      expect(subscriber).toBeDefined();
    });

    it("handles a logged feed and a logged diaper change", () => {
      expect(subscriber.handles(anEvent({ table: "feedings" }))).toBe(true);
      expect(subscriber.handles(anEvent({ table: "diaper_changes" }))).toBe(true);
    });

    it("ignores tables no reminder nags about", () => {
      expect(subscriber.handles(anEvent({ table: "notes" }))).toBe(false);
      expect(subscriber.handles(anEvent({ table: "sleep" }))).toBe(false);
    });

    // An edit or a delete cannot answer a reminder — and `clearReminderAlerts`
    // would not trust one that claimed to, since it re-asks the table rather
    // than believing the entry it was handed.
    it("ignores edits and deletes, which cannot end a gap", () => {
      expect(subscriber.handles(anEvent({ type: "entry.updated" }))).toBe(false);
      expect(subscriber.handles(anEvent({ type: "entry.deleted" }))).toBe(false);
    });
  });

  // End to end over the real route, on the inline path (no queue bound), which
  // is what the rest of the suite runs on. This is the test that would fail if
  // the create path stopped emitting at all.
  describe("the create path", () => {
    beforeEach(async () => {
      await applyMigrations(env.DB);
    });

    it("emits an entry.created carrying the child, table and new row", async () => {
      const queue = fakeQueue();
      const app = createTestApp();
      const req = testRequest(app, env.DB, undefined, {
        EVENTS: queue.binding as unknown as Env["EVENTS"],
      });

      const child = await req.post("/api/children", { first_name: "Emma", birth_date: "2024-06-15" });
      const childId = ((await child.json()) as { id: number }).id;

      const res = await req.post("/api/feedings", {
        child_id: childId,
        type: "bottle_formula",
        start_time: "2024-01-15T12:00:00.000Z",
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: number };

      const entryEvents = queue.sent.filter((e) => e.table === "feedings");
      expect(entryEvents).toHaveLength(1);
      expect(entryEvents[0]).toMatchObject({
        type: "entry.created",
        childId,
        table: "feedings",
        entryId: created.id,
      });
      // Identity, never the row — see the comment in events/types.ts. Nothing
      // about what the child was fed may ride in a queue message.
      expect(Object.keys(entryEvents[0]).sort()).toEqual(
        ["actorUserId", "at", "childId", "entryId", "table", "type"].sort(),
      );
    });
  });

  // Same guard the other queue-name constants carry: the handler tells its
  // batches apart by name, so a rename in one place and not the other routes
  // every event into the daily-summary branch.
  it("declares the queue name the config actually uses", () => {
    expect(wranglerConfig).toContain(`queue = "${EVENTS_QUEUE}"`);
  });
});
