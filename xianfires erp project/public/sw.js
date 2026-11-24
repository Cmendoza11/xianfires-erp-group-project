// Service worker for the installable app. Pages and APIs always go to the network (the ledger must be live
// and private); only static files are cached, and a cached offline page shows when there is no connection.
const VERSION = "djs-accounting-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/css/admin.css", "/js/admin.js", "/images/djs-logo.svg", "/images/app/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isStatic = (url) => /^\/(css|js|images|fonts)\//.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network only for pages; never store signed-in pages on the device.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (isStatic(url)) {
    // Serve the cached copy at once and refresh it in the background.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => { if (response.ok) cache.put(request, response.clone()); return response; })
          .catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
