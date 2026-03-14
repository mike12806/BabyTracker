import { MiddlewareHandler } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

interface JwtPayload {
  email?: string;
  name?: string;
  sub?: string;
  aud?: string[];
  exp?: number;
  iss?: string;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

async function verifyJwt(token: string, certsUrl: string, audience: string): Promise<JwtPayload | null> {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Verify audience
  if (!payload.aud || !payload.aud.includes(audience)) return null;

  // Verify expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  // Fetch CF Access public keys and verify signature
  const parts = token.split(".");
  const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))) as { kid?: string; alg?: string };

  const certsRes = await fetch(certsUrl);
  if (!certsRes.ok) return null;

  const certs = (await certsRes.json()) as { keys: JsonWebKey[] };
  const matchingKey = certs.keys.find((k: JsonWebKey & { kid?: string }) => k.kid === header.kid);
  if (!matchingKey) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    matchingKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!valid) return null;

  return payload;
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Dev mode: bypass JWT verification for local development
  if (c.env.DEV_MODE === "true") {
    const email = c.req.header("X-Dev-Email") || "dev@example.com";
    const name = c.req.header("X-Dev-Name") || "Dev User";

    await c.env.DB.prepare(
      "INSERT INTO users (email, name, created_at, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    )
      .bind(email, name)
      .run();

    const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: number; email: string; name: string }>();

    if (!user) {
      return c.json({ error: "Failed to resolve user" }, 500);
    }

    c.set("userId", user.id);
    c.set("userEmail", user.email);
    c.set("userName", user.name);
    await next();
    return;
  }

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const certsUrl = `https://${c.env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const payload = await verifyJwt(jwt, certsUrl, c.env.CF_ACCESS_AUD);

  if (!payload || !payload.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = payload.email;
  const name = payload.name || email;

  // Upsert user on every request
  await c.env.DB.prepare(
    "INSERT INTO users (email, name, created_at, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
  )
    .bind(email, name)
    .run();

  const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: number; email: string; name: string }>();

  if (!user) {
    return c.json({ error: "Failed to resolve user" }, 500);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  c.set("userName", user.name);

  await next();
};
