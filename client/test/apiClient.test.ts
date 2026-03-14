import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";

// We need to mock fetch at the global level to test the api client
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent location.reload from throwing
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  it("makes GET requests with correct headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ id: 1 }]),
    });

    const result = await api.get("/children");

    expect(mockFetch).toHaveBeenCalledWith("/api/children", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("makes POST requests with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 1, first_name: "Emma" }),
    });

    const result = await api.post("/children", { first_name: "Emma", birth_date: "2024-06-15" });

    expect(mockFetch).toHaveBeenCalledWith("/api/children", {
      method: "POST",
      body: JSON.stringify({ first_name: "Emma", birth_date: "2024-06-15" }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(result).toEqual({ id: 1, first_name: "Emma" });
  });

  it("makes DELETE requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    await api.delete("/children/1");

    expect(mockFetch).toHaveBeenCalledWith("/api/children/1", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  it("throws on non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Bad request" }),
    });

    await expect(api.get("/children")).rejects.toThrow("Bad request");
  });

  it("reloads page on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    await expect(api.get("/children")).rejects.toThrow("Unauthorized");
    expect(window.location.reload).toHaveBeenCalled();
  });
});
