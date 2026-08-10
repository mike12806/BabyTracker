/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Mirrors the `define` in vite.config.ts — the build stamp is a compile-time
  // constant, so anything rendering it is a ReferenceError without these.
  define: {
    __BUILD_ID__: JSON.stringify("test"),
    __BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
