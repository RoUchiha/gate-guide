const CACHE_NAME = "gate-guide-v1";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app-assets/app.js",
  "/app-assets/sample-data.js",
  "/app-assets/router.js",
  "/app-assets/flight-provider.js",
  "/app-assets/positioning.js",
  "/app-assets/wifi-assistant.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
