/*
 * Revamp PWA service worker. Deliberately conservative so it can never serve a
 * stale app or interfere with auth/payments:
 *   - cross-origin requests (Supabase, PayLink, Google Maps) are untouched
 *   - /api/* is never cached
 *   - navigations are network-first, falling back to the cached shell offline
 *   - same-origin static assets use stale-while-revalidate (Vite hashes filenames,
 *     so a new deploy fetches fresh assets automatically)
 */
const CACHE = "revamp-pwa-v1";
const SHELL = ["/", "/favicon.ico", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase / PayLink / Google — leave alone
  if (url.pathname.startsWith("/api/")) return; // never cache API responses

  if (req.mode === "navigate") {
    // Always try the network for HTML so the app is never stale; cached shell offline.
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
