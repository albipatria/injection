// Minimal offline app-shell cache so the installed app opens without a network hit.
const CACHE_NAME = "injection-tracker-v1";
const ASSETS = [
  "./index.html",
  "./index.css",
  "./index.js",
  "./manifest.json",
  "./assets/left.png",
  "./assets/right.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
