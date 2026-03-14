import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const auth = new Hono<AppEnv>();

// GET /api/auth/me — return current user (identity set by auth middleware)
auth.get("/me", (c) => {
  return c.json({
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  });
});

export { auth };
