// Service worker registration powered by vite-plugin-pwa.
//
// We import the virtual module dynamically so that tests (which use the same
// Vite config but don't ship a service worker) can safely skip registration
// without bundling the module.

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      // With registerType: 'autoUpdate', the new SW activates as soon as it's
      // ready. We reload once on update so the user picks up fresh assets
      // without any prompt — this app is single-user, so a brief refresh is
      // friendlier than a banner.
      registerSW({
        immediate: true,
        onNeedRefresh() {
          window.location.reload();
        },
      });
    })
    .catch(() => {
      // Ignore — service worker is a progressive enhancement.
    });
}
