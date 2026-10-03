/* =========================================
   KANJI LEARNING APP - sw.js
   Permite abrir la app sin conexión.
   Estrategia: primero la red (para recibir siempre la última versión)
   y, si falla, la copia guardada.
   ========================================= */

const CACHE = "kanji-learning-v2";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "jlpt-lists.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "https://unpkg.com/wanakana@5.3.1/wanakana.min.js"
];

// Solo se guardan la propia app, WanaKana y las fuentes;
// las consultas al diccionario y a GitHub van siempre a la red.
const CACHEABLE = [self.location.origin, "https://unpkg.com",
  "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !CACHEABLE.includes(new URL(request.url).origin)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: request.mode === "navigate" }))
  );
});
