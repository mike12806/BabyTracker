export const API_BASE = import.meta.env.VITE_API_URL || "/api";

function triggerReauth(): void {
  // Navigate (don't reload) to an /api/* URL: the service worker serves
  // cached HTML for normal navigations, so a reload never reaches Cloudflare
  // Access and the login flow can't run — this is what left the installed
  // PWA spinning forever once its session expired. Guard prevents a loop.
  const key = "auth_reload_ts";
  const last = sessionStorage.getItem(key);
  if (!last || Date.now() - Number(last) > 10_000) {
    sessionStorage.setItem(key, String(Date.now()));
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `${API_BASE}/auth/login?redirect=${redirect}`;
  }
}

async function doFetch(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    // fetch() throws (surfaced by the browser as a CORS error) when Cloudflare
    // Access redirects an unauthenticated request to its login domain instead
    // of reaching this API — treat it the same as an expired session.
    triggerReauth();
    throw new Error("Unauthorized");
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await doFetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    triggerReauth();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),

  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data) }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await doFetch(path, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (res.status === 401) {
      triggerReauth();
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  },
};
