import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { claimClientRequestId, findClaimedRowId, readClientRequestId } from "./idempotency.js";
import { announceChange } from "../live.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const children = new Hono<AppEnv>();

// GET /api/children — list all children visible to any logged-in user
children.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM children ORDER BY first_name"
  )
    .all();

  return c.json(results);
});

// GET /api/children/:id — get a single child (accessible to any logged-in user)
children.get("/:id", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  const child = await c.env.DB.prepare(
    "SELECT * FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!child) {
    return c.json({ error: "Child not found" }, 404);
  }

  return c.json(child);
});

// POST /api/children — create a child and link to current user
children.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ first_name: string; last_name?: string; birth_date: string }>();

  if (!body.first_name || !body.birth_date) {
    return c.json({ error: "first_name and birth_date are required" }, 400);
  }

  const clientRequestId = readClientRequestId(body as unknown as Record<string, unknown>);
  const priorChildId = await findClaimedRowId(c.env.DB, userId, "children", clientRequestId);
  if (priorChildId !== null) {
    const existing = await c.env.DB.prepare("SELECT * FROM children WHERE id = ?")
      .bind(priorChildId)
      .first();
    if (existing) return c.json(existing, 201);
  }

  // One batch, so the child and the link that makes it visible to its creator
  // are written together. Run apart, a failure between them left a child no
  // one was linked to — present in the database and reachable from nowhere.
  const [childInsert] = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO children (first_name, last_name, birth_date) VALUES (?, ?, ?)"
    ).bind(body.first_name, body.last_name || "", body.birth_date),
    c.env.DB.prepare(
      "INSERT INTO user_children (user_id, child_id) VALUES (?, last_insert_rowid())"
    ).bind(userId),
  ]);

  const childId = childInsert.meta.last_row_id;

  // Claimed after the fact rather than inside the batch above: the batch already
  // uses `last_insert_rowid()` for the link, and a third statement would read it
  // back as the link's id instead of the child's.
  await claimClientRequestId(c.env.DB, userId, "children", clientRequestId, Number(childId));

  const child = await c.env.DB.prepare("SELECT * FROM children WHERE id = ?")
    .bind(childId)
    .first();

  return c.json(child, 201);
});

// PUT /api/children/:id — update a child (accessible to any logged-in user)
children.put("/:id", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  // Verify child exists
  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  const body = await c.req.json<{ first_name?: string; last_name?: string; birth_date?: string }>();

  await c.env.DB.prepare(
    "UPDATE children SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), birth_date = COALESCE(?, birth_date), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  )
    .bind(body.first_name ?? null, body.last_name ?? null, body.birth_date ?? null, childId)
    .run();

  const child = await c.env.DB.prepare("SELECT * FROM children WHERE id = ?")
    .bind(childId)
    .first();

  // A rename or a corrected birth date changes the hero card and every age on
  // screen, so the other device is showing something wrong until it refetches.
  await announceChange(c, childId, "children");

  return c.json(child);
});

// DELETE /api/children/:id — delete a child (accessible to any logged-in user)
children.delete("/:id", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM children WHERE id = ?").bind(childId).run();

  // Anyone still looking at this child needs to find out now rather than by
  // getting a 404 off their next save.
  await announceChange(c, childId, "children");

  return c.json({ ok: true });
});

/**
 * Upload cap.
 *
 * The app crops and re-encodes before uploading, so a normal upload is a
 * square JPEG of a few dozen KB. The old 2 MB cap was below what a phone
 * camera produces, which meant every upload from a phone came back "File too
 * large" — the headroom here is for anything reaching this endpoint without
 * going through the cropper.
 */
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function describeBytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function photoKey(childId: number): string {
  return `children/${childId}/photo`;
}

// POST /api/children/:id/photo — upload a photo (stored in R2)
children.post("/:id/photo", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  // A truncated or malformed multipart body throws here; without the catch it
  // surfaces as a bare 500 that says nothing the user can act on.
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "The photo upload was incomplete. Please try again." }, 400);
  }

  const file = formData.get("photo") as unknown as File | null;

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return c.json({ error: "No photo file provided" }, 400);
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, 400);
  }

  if (file.size === 0) {
    return c.json({ error: "That photo file was empty. Please try again." }, 400);
  }

  if (file.size > MAX_PHOTO_SIZE) {
    return c.json(
      { error: `File too large (${describeBytes(file.size)}). Maximum size is ${describeBytes(MAX_PHOTO_SIZE)}` },
      400
    );
  }

  const buffer = await file.arrayBuffer();

  // R2 and D1 are separate writes: storing the object but not recording the
  // content type leaves a photo nothing will ever render, so report the
  // failure rather than returning ok over a half-finished upload.
  try {
    await c.env.PHOTOS.put(photoKey(childId), buffer, {
      httpMetadata: { contentType: file.type },
    });

    await c.env.DB.prepare(
      "UPDATE children SET picture_content_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    )
      .bind(file.type, childId)
      .run();
  } catch (err) {
    console.error("Photo upload failed:", err);
    return c.json({ error: "Couldn't save the photo. Please try again." }, 500);
  }

  // The photo URL is cache-busted with the child's `updated_at`, which the
  // write above just moved — so the other device needs the new child row
  // before it will fetch the new face.
  await announceChange(c, childId, "children");

  return c.json({ ok: true });
});

// GET /api/children/:id/daily-note — the cached blurb for the dashboard hero.
//
// A read, never a generation: the note is written once a day by the cron, so
// however often the app is opened, this costs one indexed D1 lookup. Notes
// older than a few days are not returned — a cron that missed a run should
// leave the card blank rather than describing last Tuesday as "yesterday".
const DAILY_NOTE_MAX_AGE_DAYS = 3;

children.get("/:id/daily-note", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  const exists = await c.env.DB.prepare("SELECT 1 FROM children WHERE id = ?")
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  const oldest = new Date(Date.now() - DAILY_NOTE_MAX_AGE_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const note = await c.env.DB.prepare(
    `SELECT note_date, body, source FROM child_daily_notes
     WHERE child_id = ? AND note_date >= ?
     ORDER BY note_date DESC LIMIT 1`
  )
    .bind(childId, oldest)
    .first<{ note_date: string; body: string; source: string }>();

  return c.json({ note: note ?? null });
});

// GET /api/children/:id/photo — serve the photo from R2
children.get("/:id/photo", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  // Verify child exists
  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  const object = await c.env.PHOTOS.get(photoKey(childId));

  if (!object) {
    return c.json({ error: "No photo found" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// DELETE /api/children/:id/photo — remove the photo from R2
children.delete("/:id/photo", async (c) => {
  const childId = parseInt(c.req.param("id"), 10);

  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();

  if (!exists) {
    return c.json({ error: "Child not found" }, 404);
  }

  await c.env.PHOTOS.delete(photoKey(childId));

  await c.env.DB.prepare(
    "UPDATE children SET picture_content_type = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  )
    .bind(childId)
    .run();

  await announceChange(c, childId, "children");

  return c.json({ ok: true });
});

export { children };
