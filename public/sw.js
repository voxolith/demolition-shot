// Demolition Shot service worker. Registered as sw.js?v=<build id>, so the
// cache name is per deploy. Strategy: precache the app shell on install,
// network-first for navigations (so a new deploy shows up), cache-first for
// hashed /assets, and stale-while-revalidate for everything else on this
// origin. After the first visit the game plays offline.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `demolition-shot-${VERSION}`;
const SCOPE = self.registration.scope; // ends with /
const SHELL = [SCOPE, `${SCOPE}index.html`, `${SCOPE}manifest.webmanifest`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("demolition-shot-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(SCOPE).pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(`${SCOPE}index.html`, copy));
          return res;
        })
        .catch(() => caches.match(`${SCOPE}index.html`).then((r) => r || caches.match(SCOPE))),
    );
    return;
  }

  const hashed = url.pathname.includes("/assets/");
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      if (cached && hashed) return cached;
      return cached ? Promise.resolve(cached) : network;
    }),
  );
});
