import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";
import { LIVE_CLIENT_HEADER, LIVE_PING, LIVE_PONG } from "../src/live";
import type { LiveMessage } from "../src/live";

/**
 * Open a live socket the way a browser would, and collect what arrives on it.
 *
 * The handshake goes through the real app — auth middleware, the route, the
 * Durable Object — so what is being tested is the path a phone actually takes,
 * not a stub standing in for it.
 */
async function openSocket(
  api: ReturnType<typeof testRequest>,
  childId: number,
  clientId?: string,
): Promise<{ messages: LiveMessage[]; ready: Promise<void>; close: () => void }> {
  const query = clientId ? `&client=${clientId}` : "";
  const res = await api.get(`/api/live?child_id=${childId}${query}`, {
    Upgrade: "websocket",
  });

  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no socket on the 101");

  const messages: LiveMessage[] = [];
  let markReady: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    const parsed = JSON.parse(event.data as string) as LiveMessage;
    messages.push(parsed);
    if (parsed.type === "ready") markReady();
  });

  ws.accept();
  await ready;

  return { messages, ready, close: () => ws.close() };
}

/**
 * Give a broadcast time to cross the socket.
 *
 * The write returns as soon as the Durable Object has accepted the publish;
 * delivery to the client end is a separate hop. Polling for it rather than
 * sleeping a fixed amount keeps the test fast when it passes and honest when
 * it fails.
 */
async function waitForChange(messages: LiveMessage[], timeoutMs = 1000): Promise<LiveMessage[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const changes = messages.filter((m) => m.type === "change");
    if (changes.length > 0) return changes;
    await scheduler.wait(10);
  }
  return messages.filter((m) => m.type === "change");
}

describe("Live updates", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB, undefined, { LIVE: env.LIVE });

    const res = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    childId = ((await res.json()) as { id: number }).id;
  });

  it("rejects a plain GET with 426 rather than opening anything", async () => {
    const res = await api.get(`/api/live?child_id=${childId}`);
    expect(res.status).toBe(426);
  });

  it("404s a child that does not exist", async () => {
    const res = await api.get("/api/live?child_id=9999", { Upgrade: "websocket" });
    expect(res.status).toBe(404);
  });

  it("reports 503 when the binding is missing, so the client can fall back", async () => {
    const noLive = testRequest(createTestApp(), env.DB);
    const res = await noLive.get(`/api/live?child_id=${childId}`, { Upgrade: "websocket" });
    expect(res.status).toBe(503);
  });

  it("does not stamp Cache-Control on the handshake", async () => {
    // Setting a header rebuilds the Response, and a rebuilt Response has no
    // `webSocket` — the socket would open and then never deliver anything.
    const res = await api.get(`/api/live?child_id=${childId}`, { Upgrade: "websocket" });
    expect(res.status).toBe(101);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(res.webSocket).toBeTruthy();
    // Accepted and closed rather than dropped on the floor: an unaccepted
    // socket is torn down at the end of the test and workerd logs the
    // disconnect, which is noise in a suite that is otherwise quiet.
    res.webSocket!.accept();
    res.webSocket!.close();
  });

  it("greets a new connection so the client knows the socket works end to end", async () => {
    const socket = await openSocket(api, childId);
    expect(socket.messages[0]?.type).toBe("ready");
    socket.close();
  });

  it("tells a watching device when an entry is logged", async () => {
    const socket = await openSocket(api, childId);

    await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-07-01T10:00:00Z",
      amount: 120,
    });

    const changes = await waitForChange(socket.messages);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: "change", kind: "entries" });
    socket.close();
  });

  it("carries no entry data, only the fact that something changed", async () => {
    // The nudge is a cache-invalidation signal, not a second copy of the data
    // arriving by a path with no staleness accounting. See src/live.ts.
    const socket = await openSocket(api, childId);

    await api.post("/api/notes", {
      child_id: childId,
      time: "2024-07-01T10:00:00Z",
      content: "slept through the night",
    });

    const [change] = await waitForChange(socket.messages);
    expect(JSON.stringify(change)).not.toContain("slept through");
    expect(Object.keys(change).sort()).toEqual(["at", "kind", "type"]);
    socket.close();
  });

  it("skips the device that made the change", async () => {
    const socket = await openSocket(api, childId, "phone-a");

    await api.post(
      "/api/feedings",
      { child_id: childId, type: "bottle_formula", start_time: "2024-07-01T10:00:00Z" },
      { [LIVE_CLIENT_HEADER]: "phone-a" },
    );

    // It refreshed itself the moment it saved; getting its own change back
    // would rebuild every list under the user for nothing.
    const changes = await waitForChange(socket.messages, 300);
    expect(changes).toHaveLength(0);
    socket.close();
  });

  it("still tells the other devices about a change one of them originated", async () => {
    const watcher = await openSocket(api, childId, "phone-b");

    await api.post(
      "/api/feedings",
      { child_id: childId, type: "bottle_formula", start_time: "2024-07-01T10:00:00Z" },
      { [LIVE_CLIENT_HEADER]: "phone-a" },
    );

    const changes = await waitForChange(watcher.messages);
    expect(changes).toHaveLength(1);
    watcher.close();
  });

  it("announces edits and deletes, not just creates", async () => {
    const created = await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-07-01T10:00:00Z",
      amount: 120,
    });
    const feeding = (await created.json()) as { id: number };

    const socket = await openSocket(api, childId);

    await api.put(`/api/feedings/${feeding.id}`, { amount: 150 });
    let changes = await waitForChange(socket.messages);
    expect(changes).toHaveLength(1);

    socket.messages.length = 0;
    await api.delete(`/api/feedings/${feeding.id}`);
    changes = await waitForChange(socket.messages);
    expect(changes).toHaveLength(1);

    socket.close();
  });

  it("labels timer changes so a running timer shows up on the other phone", async () => {
    const socket = await openSocket(api, childId);

    await api.post("/api/timers", { child_id: childId, name: "Feeding" });

    const [change] = await waitForChange(socket.messages);
    expect(change).toMatchObject({ kind: "timers" });
    socket.close();
  });

  it("does not reach a device watching a different child", async () => {
    const otherRes = await api.post("/api/children", {
      first_name: "Noah",
      birth_date: "2023-01-10",
    });
    const otherChildId = ((await otherRes.json()) as { id: number }).id;

    const socket = await openSocket(api, otherChildId);

    await api.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-07-01T10:00:00Z",
    });

    const changes = await waitForChange(socket.messages, 300);
    expect(changes).toHaveLength(0);
    socket.close();
  });

  it("answers the heartbeat without waking the object", async () => {
    // `setWebSocketAutoResponse` is what keeps a day-long connection free: the
    // reply is generated by the runtime, so a heartbeat costs no duration.
    const res = await api.get(`/api/live?child_id=${childId}`, { Upgrade: "websocket" });
    const ws = res.webSocket!;
    const replies: string[] = [];
    ws.addEventListener("message", (event: MessageEvent) => {
      replies.push(event.data as string);
    });
    ws.accept();

    ws.send(LIVE_PING);

    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && !replies.includes(LIVE_PONG)) {
      await scheduler.wait(10);
    }
    expect(replies).toContain(LIVE_PONG);
    ws.close();
  });

  it("keeps saving when the broadcast cannot be delivered", async () => {
    // A live nudge is a convenience on top of a client that still polls. It
    // must never be the reason an entry fails to be recorded.
    const broken = testRequest(createTestApp(), env.DB, undefined, {
      LIVE: {
        idFromName() {
          throw new Error("durable object unavailable");
        },
      } as unknown as typeof env.LIVE,
    });

    const res = await broken.post("/api/feedings", {
      child_id: childId,
      type: "bottle_formula",
      start_time: "2024-07-01T10:00:00Z",
      amount: 120,
    });

    expect(res.status).toBe(201);
  });
});
