import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Child Photo API (R2)", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB, env.PHOTOS);

    // Clean up R2 bucket
    const listed = await env.PHOTOS.list();
    for (const obj of listed.objects) {
      await env.PHOTOS.delete(obj.key);
    }

    // Create a child to work with
    await api.post("/api/children", {
      first_name: "Emma",
      last_name: "Smith",
      birth_date: "2024-06-15",
    });
  });

  function createTestImage(type = "image/png", size = 100): File {
    const data = new Uint8Array(size);
    return new File([data], "test.png", { type });
  }

  it("POST /api/children/:id/photo uploads a photo", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage());

    const res = await api.postForm("/api/children/1/photo", formData);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/children/:id/photo serves an uploaded photo", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage("image/png", 50));
    await api.postForm("/api/children/1/photo", formData);

    const res = await api.get("/api/children/1/photo");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBe(50);
  });

  it("GET /api/children/:id/photo returns 404 when no photo", async () => {
    const res = await api.get("/api/children/1/photo");
    expect(res.status).toBe(404);
  });

  it("DELETE /api/children/:id/photo removes the photo", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage());
    await api.postForm("/api/children/1/photo", formData);

    const delRes = await api.delete("/api/children/1/photo");
    expect(delRes.status).toBe(200);

    const getRes = await api.get("/api/children/1/photo");
    expect(getRes.status).toBe(404);
  });

  it("POST /api/children/:id/photo rejects invalid file types", async () => {
    const formData = new FormData();
    formData.append("photo", new File([new Uint8Array(10)], "test.txt", { type: "text/plain" }));

    const res = await api.postForm("/api/children/1/photo", formData);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid file type");
  });

  it("POST /api/children/:id/photo rejects oversized files", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage("image/png", 3 * 1024 * 1024));

    const res = await api.postForm("/api/children/1/photo", formData);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("too large");
  });

  it("returns 404 for photo on non-existent child", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage());

    const res = await api.postForm("/api/children/999/photo", formData);
    expect(res.status).toBe(404);
  });

  it("updates picture_content_type in children table on upload", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage("image/jpeg", 50));
    await api.postForm("/api/children/1/photo", formData);

    const res = await api.get("/api/children/1");
    const child = (await res.json()) as { picture_content_type: string | null };
    expect(child.picture_content_type).toBe("image/jpeg");
  });

  it("clears picture_content_type on photo delete", async () => {
    const formData = new FormData();
    formData.append("photo", createTestImage("image/png", 50));
    await api.postForm("/api/children/1/photo", formData);

    await api.delete("/api/children/1/photo");

    const res = await api.get("/api/children/1");
    const child = (await res.json()) as { picture_content_type: string | null };
    expect(child.picture_content_type).toBeNull();
  });
});
