import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "icons/apple-touch-icon.png",
        "icons/icon.svg",
        "icons/icon-maskable.svg",
      ],
      manifest: {
        name: "Baby Tracker",
        short_name: "Baby Tracker",
        description: "Track feedings, diapers, sleep, and more",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#5c6bc0",
        background_color: "#f5f5f5",
        categories: ["lifestyle", "health"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // /cdn-cgi/ is the Cloudflare Access login callback — if the SW
        // answers it with cached HTML the auth cookie is never set.
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        runtimeCaching: [
          {
            // Never intercept navigations: top-level requests to /api/auth/login
            // must reach the edge so Access can run its redirect flow.
            urlPattern: ({ url, request }) =>
              request.method === "GET" &&
              request.mode !== "navigate" &&
              url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              // Deliberately no `networkTimeoutSeconds`. It used to be 5s,
              // which meant a merely slow connection — the normal case on a
              // phone in a nursery — silently abandoned a request that was
              // about to succeed and answered from cache instead, with
              // nothing on screen to say the feed times were minutes stale.
              // Without it the cache is only consulted when the network
              // genuinely fails, so a live network always wins.
              expiration: {
                maxEntries: 60,
                // Only reachable while offline now, and a day-old reading
                // labelled as stale beats an empty screen. `useDataFreshness`
                // puts the banner up whenever one of these is served.
                maxAgeSeconds: 60 * 60 * 24,
              },
              // 200 only: an opaque (status 0) response here would be the
              // Cloudflare Access login redirect, which is not data.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com" ||
              url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
