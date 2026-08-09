import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("API cache headers", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("marks collection reads as no-store", async () => {
    const res = await api.get("/api/children");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("marks reads that carry a child's entries as no-store", async () => {
    const child = (await (
      await api.post("/api/children", { first_name: "Nolan", birth_date: "2026-01-04" })
    ).json()) as { id: number };

    const res = await api.get(`/api/feedings?child_id=${child.id}`);
    expect(res.status).toBe(200);
    // The whole point: another caregiver's phone may have logged a feed a
    // second ago, so no cache anywhere may answer this on the app's behalf.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("marks writes and errors as no-store too", async () => {
    const created = await api.post("/api/children", {
      first_name: "Mikey",
      birth_date: "2026-01-04",
    });
    expect(created.headers.get("Cache-Control")).toBe("no-store");

    const missing = await api.get("/api/children/999999");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves a handler's own caching policy alone", async () => {
    // Photos are immutable for a given `?v=updated_at`, so the photo route sets
    // `private, max-age=3600` and must keep it — re-fetching every avatar on
    // every render is exactly what that cache-buster exists to avoid.
    const bucket: R2Bucket = env.PHOTOS;
    const withPhotos = testRequest(createTestApp(), env.DB, bucket);

    const child = (await (
      await withPhotos.post("/api/children", { first_name: "Emma", birth_date: "2026-01-04" })
    ).json()) as { id: number };

    const formData = new FormData();
    formData.append("photo", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));
    await withPhotos.postForm(`/api/children/${child.id}/photo`, formData);

    const res = await withPhotos.get(`/api/children/${child.id}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });
});
