import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const children = new Hono<AppEnv>();

// GET /api/children — list children for the current user
children.get("/", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT c.* FROM children c JOIN user_children uc ON c.id = uc.child_id WHERE uc.user_id = ? ORDER BY c.first_name"
  )
    .bind(userId)
    .all();

  return c.json(results);
});

// GET /api/children/:id — get a single child
children.get("/:id", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  const child = await c.env.DB.prepare(
    "SELECT c.* FROM children c JOIN user_children uc ON c.id = uc.child_id WHERE c.id = ? AND uc.user_id = ?"
  )
    .bind(childId, userId)
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

  const result = await c.env.DB.prepare(
    "INSERT INTO children (first_name, last_name, birth_date) VALUES (?, ?, ?)"
  )
    .bind(body.first_name, body.last_name || "", body.birth_date)
    .run();

  const childId = result.meta.last_row_id;

  await c.env.DB.prepare("INSERT INTO user_children (user_id, child_id) VALUES (?, ?)")
    .bind(userId, childId)
    .run();

  const child = await c.env.DB.prepare("SELECT * FROM children WHERE id = ?")
    .bind(childId)
    .first();

  return c.json(child, 201);
});

// PUT /api/children/:id — update a child
children.put("/:id", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  // Verify access
  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
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

  return c.json(child);
});

// DELETE /api/children/:id — delete a child
children.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
    return c.json({ error: "Child not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM children WHERE id = ?").bind(childId).run();

  return c.json({ ok: true });
});

const MAX_PHOTO_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function photoKey(childId: number): string {
  return `children/${childId}/photo`;
}

// POST /api/children/:id/photo — upload a photo (stored in R2)
children.post("/:id/photo", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
    return c.json({ error: "Child not found" }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get("photo") as unknown as File | null;

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return c.json({ error: "No photo file provided" }, 400);
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, 400);
  }

  if (file.size > MAX_PHOTO_SIZE) {
    return c.json({ error: "File too large. Maximum size is 2 MB" }, 400);
  }

  const buffer = await file.arrayBuffer();

  await c.env.PHOTOS.put(photoKey(childId), buffer, {
    httpMetadata: { contentType: file.type },
  });

  await c.env.DB.prepare(
    "UPDATE children SET picture_content_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  )
    .bind(file.type, childId)
    .run();

  return c.json({ ok: true });
});

// GET /api/children/:id/photo — serve the photo from R2
children.get("/:id/photo", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  // Verify access
  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
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
  const userId = c.get("userId");
  const childId = parseInt(c.req.param("id"), 10);

  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
    return c.json({ error: "Child not found" }, 404);
  }

  await c.env.PHOTOS.delete(photoKey(childId));

  await c.env.DB.prepare(
    "UPDATE children SET picture_content_type = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  )
    .bind(childId)
    .run();

  return c.json({ ok: true });
});

export { children };
