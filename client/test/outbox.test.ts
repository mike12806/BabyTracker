import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    get: vi.fn(),
    getOptional: vi.fn(),
    post: vi.fn(),
    postSlow: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  pingServer: vi.fn(async () => true),
  API_BASE: "/api",
}));

import { api } from "../src/api/client";
import { ApiError } from "../src/api/errors";
import {
  MAX_OUTBOX_ENTRIES,
  MAX_SERVER_ATTEMPTS,
  createEntry,
  discardPendingRow,
  enqueue,
  failedEntries,
  flushOutbox,
  getOutboxSnapshot,
  isPending,
  mergePending,
  pendingEntries,
  pendingRowsFor,
  resetOutbox,
} from "../src/api/outbox";

const mockApi = vi.mocked(api);

const FEED = {
  child_id: 1,
  client_request_id: "attempt-1.abc",
  type: "bottle_formula",
  start_time: "2026-08-25T14:05:00.000Z",
  end_time: null,
  amount: 120,
  amount_unit: "ml",
  notes: null,
};

/** A rejection shaped exactly like the ones `client.ts` throws. */
const offline = () => new ApiError("Network error — check your connection and try again.");
const rejected = (status: number, message = `Request failed (HTTP ${status})`) =>
  new ApiError(message, status);

beforeEach(() => {
  vi.clearAllMocks();
  resetOutbox();
});

describe("createEntry", () => {
  it("returns the saved row when the server takes it, and queues nothing", async () => {
    mockApi.post.mockResolvedValueOnce({ id: 7, ...FEED });

    const outcome = await createEntry("feedings", 1, FEED);

    expect(outcome.status).toBe("saved");
    expect(getOutboxSnapshot()).toHaveLength(0);
  });

  it("queues the entry when the request never got an answer", async () => {
    mockApi.post.mockRejectedValueOnce(offline());

    const outcome = await createEntry("feedings", 1, FEED);

    expect(outcome.status).toBe("queued");
    const [entry] = getOutboxSnapshot();
    // The body is stored verbatim — key included — because that is what makes
    // sending it later the same request rather than a second one.
    expect(entry.body).toEqual(FEED);
    expect(entry.resource).toBe("feedings");
    expect(entry.childId).toBe(1);
  });

  it("queues on an expired session, because re-auth navigates the form away", async () => {
    mockApi.post.mockRejectedValueOnce(rejected(401, "Unauthorized"));

    const outcome = await createEntry("feedings", 1, FEED);

    expect(outcome.status).toBe("queued");
  });

  it("queues a server error, which may yet come good", async () => {
    mockApi.post.mockRejectedValueOnce(rejected(503, "The server had a problem (HTTP 503)."));

    expect((await createEntry("feedings", 1, FEED)).status).toBe("queued");
  });

  it("does not queue a payload the server rejected — another attempt fails the same way", async () => {
    mockApi.post.mockRejectedValueOnce(rejected(400, "start_time is required"));

    const outcome = await createEntry("feedings", 1, FEED);

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error.message).toBe("start_time is required");
    expect(getOutboxSnapshot()).toHaveLength(0);
  });

  it("reports a failure rather than pretending, when storage will not take the entry", async () => {
    for (let i = 0; i < MAX_OUTBOX_ENTRIES; i++) {
      expect(enqueue("feedings", 1, { ...FEED, client_request_id: `k${i}` })).not.toBeNull();
    }
    mockApi.post.mockRejectedValueOnce(offline());

    const outcome = await createEntry("feedings", 1, FEED);

    // Telling the user it is safe on the device when nothing recorded it is
    // the one outcome worse than an error toast.
    expect(outcome.status).toBe("failed");
    expect(getOutboxSnapshot()).toHaveLength(MAX_OUTBOX_ENTRIES);
  });
});

describe("flushOutbox", () => {
  it("sends queued entries oldest first and clears them", async () => {
    enqueue("feedings", 1, { ...FEED, client_request_id: "first" });
    enqueue("diaper_changes", 1, { child_id: 1, client_request_id: "second", time: "x", type: "wet" });
    mockApi.post.mockResolvedValue({ id: 1 });

    const summary = await flushOutbox();

    expect(summary).toMatchObject({ synced: 2, rejected: 0, remaining: 0, stoppedBecause: null });
    expect(mockApi.post.mock.calls.map((call) => call[0])).toEqual(["/feedings", "/diaper-changes"]);
    expect(getOutboxSnapshot()).toHaveLength(0);
  });

  it("sends the key it was queued with, so a replay cannot duplicate the entry", async () => {
    enqueue("feedings", 1, FEED);
    mockApi.post.mockResolvedValue({ id: 1 });

    await flushOutbox();

    expect(mockApi.post).toHaveBeenCalledWith("/feedings", FEED);
  });

  it("stops at the first dead connection instead of marching the rest into it", async () => {
    enqueue("feedings", 1, { ...FEED, client_request_id: "a" });
    enqueue("feedings", 1, { ...FEED, client_request_id: "b" });
    enqueue("feedings", 1, { ...FEED, client_request_id: "c" });
    mockApi.post.mockRejectedValue(offline());

    const summary = await flushOutbox();

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ synced: 0, remaining: 3, stoppedBecause: "offline" });
  });

  it("does not count an unreachable server against an entry", async () => {
    enqueue("feedings", 1, FEED);
    mockApi.post.mockRejectedValue(offline());

    for (let i = 0; i < MAX_SERVER_ATTEMPTS + 2; i++) await flushOutbox();

    // A weekend out of signal must not dead-letter a perfectly good feed.
    expect(failedEntries()).toHaveLength(0);
    expect(pendingEntries()[0].serverAttempts).toBe(0);
  });

  it("sets aside an entry the server rejects, and carries on with the rest", async () => {
    enqueue("feedings", 1, { ...FEED, client_request_id: "gone" });
    enqueue("feedings", 1, { ...FEED, client_request_id: "fine" });
    mockApi.post
      .mockRejectedValueOnce(rejected(404, "Child not found"))
      .mockResolvedValueOnce({ id: 2 });

    const summary = await flushOutbox();

    expect(summary).toMatchObject({ synced: 1, rejected: 1, remaining: 0 });
    // Kept, not dropped: it is the user's data, and only the user may bin it.
    expect(failedEntries()).toHaveLength(1);
    expect(failedEntries()[0].failure).toBe("Child not found");
  });

  it("gives up on an entry the server keeps failing, rather than queuing forever", async () => {
    enqueue("feedings", 1, FEED);
    mockApi.post.mockRejectedValue(rejected(500, "The server had a problem (HTTP 500)."));

    for (let i = 0; i < MAX_SERVER_ATTEMPTS; i++) await flushOutbox();

    expect(failedEntries()).toHaveLength(1);
    expect(pendingEntries()).toHaveLength(0);
  });

  it("holds everything when the session has expired", async () => {
    enqueue("feedings", 1, { ...FEED, client_request_id: "a" });
    enqueue("feedings", 1, { ...FEED, client_request_id: "b" });
    mockApi.post.mockRejectedValue(rejected(401, "Unauthorized"));

    const summary = await flushOutbox();

    expect(summary.stoppedBecause).toBe("auth");
    expect(pendingEntries()).toHaveLength(2);
  });

  it("runs one flush at a time however many triggers fire together", async () => {
    enqueue("feedings", 1, FEED);
    mockApi.post.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: 1 }), 5)),
    );

    const [a, b, c] = await Promise.all([flushOutbox(), flushOutbox(), flushOutbox()]);

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect([a, b, c].every((summary) => summary.synced === 1)).toBe(true);
  });

  it("leaves a set-aside entry alone until the user asks for it again", async () => {
    enqueue("feedings", 1, FEED);
    mockApi.post.mockRejectedValueOnce(rejected(400, "type is required"));
    await flushOutbox();
    mockApi.post.mockClear();

    await flushOutbox();

    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

describe("pending rows", () => {
  it("renders a queued create as a row the page can show, with a negative id", () => {
    enqueue("feedings", 1, FEED);

    const [row] = pendingRowsFor<Record<string, unknown>>("feedings", 1);

    expect(row.id).toBeLessThan(0);
    expect(isPending(row as { id: number })).toBe(true);
    expect(row.start_time).toBe(FEED.start_time);
    expect(row.pending).toBe(true);
    // Transport, not part of the entry — it must not leak into the rendered row.
    expect(row.client_request_id).toBeUndefined();
  });

  it("keeps another child's entries out of this child's list", () => {
    enqueue("feedings", 1, FEED);
    enqueue("feedings", 2, { ...FEED, client_request_id: "other" });

    expect(pendingRowsFor("feedings", 1)).toHaveLength(1);
  });

  it("gives every queued entry its own id, so the list can key on it", () => {
    enqueue("feedings", 1, { ...FEED, client_request_id: "a" });
    enqueue("feedings", 1, { ...FEED, client_request_id: "b" });

    const ids = pendingRowsFor<{ id: number }>("feedings", 1).map((row) => row.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("sorts a backdated entry into the log rather than onto the top of it", () => {
    const server = [
      { id: 2, start_time: "2026-08-25T15:00:00.000Z" },
      { id: 1, start_time: "2026-08-25T09:00:00.000Z" },
    ];
    const pending = [{ id: -1, start_time: "2026-08-25T12:00:00.000Z" }];

    expect(mergePending(server, pending, "start_time").map((row) => row.id)).toEqual([2, -1, 1]);
  });

  it("leaves the server's list untouched when nothing is queued", () => {
    const server = [{ id: 1, time: "2026-08-25T09:00:00.000Z" }];

    expect(mergePending(server, [], "time")).toBe(server);
  });
});

describe("discarding", () => {
  it("drops a pending row by the id the list rendered it with", () => {
    const entry = enqueue("feedings", 1, FEED)!;

    expect(discardPendingRow(entry.rowId)).toBe(true);
    expect(getOutboxSnapshot()).toHaveLength(0);
  });

  it("declines a real row, so a page can fall through to the API", () => {
    expect(discardPendingRow(42)).toBe(false);
  });
});

describe("storage", () => {
  it("survives a reload — the queue is on disk, not in memory", async () => {
    mockApi.post.mockRejectedValueOnce(offline());
    await createEntry("feedings", 1, FEED);

    const onDisk = localStorage.getItem("babytracker.outbox.v1");
    // What a relaunch looks like: nothing in memory, everything still in
    // storage. iOS evicts a backgrounded PWA whenever it likes, so this is the
    // ordinary case rather than an edge one.
    resetOutbox();
    localStorage.setItem("babytracker.outbox.v1", onDisk!);

    expect(pendingEntries()).toHaveLength(1);
  });

  it("ignores stored junk rather than taking the app down with it", () => {
    resetOutbox();
    localStorage.setItem("babytracker.outbox.v1", '[{"nope":true},"garbage"]');

    expect(getOutboxSnapshot()).toEqual([]);
  });
});
