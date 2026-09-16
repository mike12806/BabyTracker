/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { env } from "cloudflare:test";
import { authMiddleware } from "../src/middleware/auth.js";
import { cachePut } from "../src/kv/cache.js";
import {
  cacheKeyKind,
  recordCacheAccess,
  recordGeneration,
  recordPush,
  recordQueueOutcome,
} from "../src/telemetry.js";
import { boopPoolKey, dailyNoteKey, jwksKey, userKey } from "../src/kv/keys.js";
import type { Env } from "../src/types/env.js";

type TestEnv = typeof env & Env;

/** An `Env` carrying a recording stand-in for the Analytics Engine binding. */
function withMetrics(): { env: Env; points: AnalyticsEngineDataPoint[] } {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    env: {
      ...(env as TestEnv),
      METRICS: { writeDataPoint: (point) => void points.push(point) },
    },
    points,
  };
}

describe("telemetry", () => {
  // The contract the rest of `src/` relies on: nothing here is on a path whose
  // correctness depends on it, so nothing here may throw. The tests and local
  // dev run without the binding, which makes this the *common* case rather
  // than a degraded one.
  describe("without the binding", () => {
    it("does nothing at all rather than throwing", () => {
      const bare = { ...(env as TestEnv), METRICS: undefined };

      expect(() => recordGeneration(bare, "daily_note", "ai", "some-model")).not.toThrow();
      expect(() => recordQueueOutcome(bare, "a-queue", "ack", 1)).not.toThrow();
      expect(() => recordPush(bare, "reminder", "sent")).not.toThrow();
      expect(() => recordCacheAccess(bare, "daily-note", true)).not.toThrow();
    });
  });

  describe("with a binding that fails", () => {
    it("swallows the error, like every other optimisation in this Worker", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = {
        ...(env as TestEnv),
        METRICS: {
          writeDataPoint: () => {
            throw new Error("Analytics Engine is having a bad minute");
          },
        } as AnalyticsEngineDataset,
      };

      expect(() => recordPush(broken, "reminder", "sent")).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  // Analytics Engine has no column names — the SQL API addresses `blob1..n` by
  // position — so the layout is the schema. These assertions are deliberately
  // written against positions rather than against a helper, because a test
  // that read the value back through the same constant that wrote it could not
  // fail when the position moved, which is the only failure worth catching
  // here. See the header comment in `src/telemetry.ts`.
  describe("the positional schema", () => {
    it("puts the event name first, so a query can filter on it", () => {
      const { env: e, points } = withMetrics();

      recordGeneration(e, "daily_note", "ai", "some-model");
      recordQueueOutcome(e, "baby-tracker-daily-note", "ack", 1);
      recordPush(e, "reminder_diaper", "sent");
      recordCacheAccess(e, "daily-note", true);

      expect(points.map((p) => p.blobs?.[0])).toEqual([
        "generation",
        "queue",
        "push",
        "cache",
      ]);
      // The index is what Analytics Engine samples and groups by, and every
      // query starts by filtering on the event name.
      expect(points.every((p) => p.indexes?.[0] === p.blobs?.[0])).toBe(true);
    });

    it("records a generation as feature, source, model, reason", () => {
      const { env: e, points } = withMetrics();

      recordGeneration(e, "boop_lines", "fallback", "chain", "out of capacity");

      expect(points[0].blobs).toEqual([
        "generation",
        "boop_lines",
        "fallback",
        "chain",
        "out of capacity",
      ]);
      // `double1` duplicates the source as a number so that `avg(double1)` is
      // a success rate — the one figure anybody actually wants out of this.
      expect(points[0].doubles).toEqual([0]);
    });

    it("scores a generation the model answered as a 1", () => {
      const { env: e, points } = withMetrics();

      recordGeneration(e, "daily_note", "ai", "some-model");

      expect(points[0].doubles).toEqual([1]);
      // An absent reason is written as an empty string rather than left off,
      // so every `generation` point has the same arity.
      expect(points[0].blobs).toHaveLength(5);
    });

    it("records the attempt count on a queue outcome", () => {
      const { env: e, points } = withMetrics();

      recordQueueOutcome(e, "baby-tracker-daily-note", "retry", 3);

      expect(points[0].blobs).toEqual(["queue", "baby-tracker-daily-note", "retry"]);
      // Attempts first, then the ack/retry as a number — a queue that always
      // succeeds on its third attempt is the case this exists to make visible.
      expect(points[0].doubles).toEqual([3, 0]);
    });

    it("separates an expired push subscription from a failed send", () => {
      const { env: e, points } = withMetrics();

      recordPush(e, "reminder_diaper", "expired");
      recordPush(e, "reminder_diaper", "failed");
      recordPush(e, "reminder_diaper", "sent");

      expect(points.map((p) => p.blobs?.[2])).toEqual(["expired", "failed", "sent"]);
      // Only a send that actually reached the push service scores.
      expect(points.map((p) => p.doubles?.[0])).toEqual([0, 0, 1]);
    });
  });

  // The kind, not the key: `daily-note:7` and `daily-note:8` are the same
  // question asked about two children, and a hit rate only means anything once
  // they are counted together.
  describe("cacheKeyKind", () => {
    it("groups every real cache key by what it names", () => {
      expect(cacheKeyKind(jwksKey())).toBe("access-jwks");
      expect(cacheKeyKind(boopPoolKey())).toBe("boop-lines");
      expect(cacheKeyKind(userKey("someone@example.com"))).toBe("user");
      expect(cacheKeyKind(dailyNoteKey(7))).toBe("daily-note");
    });

    it("folds every child's note into one kind", () => {
      expect(cacheKeyKind(dailyNoteKey(7))).toBe(cacheKeyKind(dailyNoteKey(8)));
    });

    it("reports a key it does not recognise as `other` rather than guessing", () => {
      // A mislabelled point is worse than an unlabelled one: it lands in
      // somebody else's total, where nothing will ever flag it.
      expect(cacheKeyKind("no-colons-here")).toBe("other");
      expect(cacheKeyKind("")).toBe("other");
      expect(cacheKeyKind("v1:")).toBe("other");
    });
  });

  // The two hottest cache reads in the Worker do not go through `cached()` —
  // `authMiddleware` uses `cacheGet` directly for both, because each has a
  // conditional hit test `cached()` cannot express. They are instrumented at
  // their own call sites, and these are the tests that would fail if that were
  // ever quietly undone, leaving a hit rate that excluded all the volume.
  describe("the auth path, which does not use cached()", () => {
    /** The real middleware on its DEV_MODE path, so no JWT is needed. */
    function devApp() {
      const app = new Hono<{ Bindings: Env; Variables: { userId: number; userName: string } }>();
      app.use("/api/*", authMiddleware);
      app.get("/api/whoami", (c) => c.json({ id: c.get("userId") }));
      return app;
    }

    it("records a miss when the caller's row is not cached yet", async () => {
      const { env: e, points } = withMetrics();

      await devApp().request(
        "/api/whoami",
        { headers: { "X-Dev-Email": "fresh@example.com" } },
        { ...e, DEV_MODE: "true" } as unknown as Env,
      );

      const user = points.filter((p) => p.blobs?.[0] === "cache" && p.blobs?.[1] === "user");
      expect(user).toHaveLength(1);
      expect(user[0].blobs?.[2]).toBe("miss");
    });

    it("records a hit once the row is cached", async () => {
      const { env: e, points } = withMetrics();
      await cachePut(
        e,
        userKey("known@example.com"),
        { id: 4242, email: "known@example.com", name: "Known" },
        60,
      );

      await devApp().request(
        "/api/whoami",
        { headers: { "X-Dev-Email": "known@example.com", "X-Dev-Name": "Known" } },
        { ...e, DEV_MODE: "true" } as unknown as Env,
      );

      const user = points.filter((p) => p.blobs?.[0] === "cache" && p.blobs?.[1] === "user");
      expect(user).toHaveLength(1);
      expect(user[0].blobs?.[2]).toBe("hit");
    });

    it("counts a renamed account as a miss, because it still pays for D1", async () => {
      // The cached row is present and valid; it is simply no longer usable,
      // and auth falls through to the upsert. Counting that as a hit would
      // report a cache that is working when it is not saving anything.
      const { env: e, points } = withMetrics();
      await cachePut(
        e,
        userKey("renamed@example.com"),
        { id: 99, email: "renamed@example.com", name: "Old Name" },
        60,
      );

      await devApp().request(
        "/api/whoami",
        { headers: { "X-Dev-Email": "renamed@example.com", "X-Dev-Name": "New Name" } },
        { ...e, DEV_MODE: "true" } as unknown as Env,
      );

      const user = points.filter((p) => p.blobs?.[0] === "cache" && p.blobs?.[1] === "user");
      expect(user).toHaveLength(1);
      expect(user[0].blobs?.[2]).toBe("miss");
    });
  });
});
