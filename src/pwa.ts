// Installable web app: registers the service worker under the deploy base.
// The build id in the query makes each deploy install a fresh worker, whose
// cache name derives from it, so stale assets never outlive a release.

declare const __BUILD_ID__: string;

export function registerPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const url = `${base}sw.js?v=${encodeURIComponent(__BUILD_ID__)}`;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url, { scope: base }).catch((e) => console.warn("[pwa] register failed", e));
  });
}
