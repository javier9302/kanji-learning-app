/* =========================================
   KANJI LEARNING APP - sw.js
   Permite abrir la app sin conexión. Dos estrategias:
   - La app (HTML, JS, CSS, banco): primero la red, para recibir siempre la
     última versión, y si falla, la copia guardada.
   - Lo grande que nunca cambia (el diccionario de kuromoji, unos 17 MB, y las
     librerías con versión fija): primero la copia guardada. Se descarga una
     sola vez por dispositivo y se guarda aparte (LASTING), así que publicar una
     versión nueva de la app no lo borra.
   ========================================= */

const CACHE = "kanji-learning-v25";
/* Súbelo SOLO si cambian los archivos de vendor/: obliga a descargarlos otra vez */
const LASTING = "kanji-lasting-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "config.js",
  "i18n.js",
  "vendor/ts-fsrs/index.umd.js",
  "bank/bank.js",
  "bank/frequency.js",
  "bank/aliases.js",
  "study-config.js",
  "learning-core.js",
  "progress-core.js",
  "grammar-core.js",
  "bank/n5.js",
  "ja-core.js",
  "sentences-core.js",
  "kanji-core.js",
  "ranking-core.js",
  "story-core.js",
  "translate-core.js",
  "texts.js",
  "reading.js",
  "reading-stats.js",
  "reading-sync.js",
  "study.js",
  "sentences.js",
  "translate.js",
  "progress.js",
  "kanji-table.js",
  "proof.js",
  "today.js",
  "dictionary.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "https://unpkg.com/wanakana@5.3.1/wanakana.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js"
];

// Solo se guardan la propia app, WanaKana, las fuentes y los trazos de KanjiVG;
// las consultas al diccionario y a Supabase van siempre a la red.
const CACHEABLE = [self.location.origin, "https://unpkg.com", "https://cdn.jsdelivr.net",
  "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

/* ¿Es de lo que nunca cambia? vendor/ de la propia app y las librerías de los
   CDN, que llevan la versión en la dirección (wanakana@5.3.1). Los trazos de
   KanjiVG del CDN también: ese archivo de un kanji no cambia. */
function isLasting(url) {
  if (url.origin === self.location.origin) return url.pathname.includes("/vendor/");
  return url.origin === "https://unpkg.com" || url.origin === "https://cdn.jsdelivr.net" ||
    url.origin === "https://fonts.gstatic.com";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

/* Al activarse una versión nueva: lo duradero que hubiera en las copias
   antiguas pasa a LASTING (así nadie vuelve a descargar el diccionario) y
   después se borran las copias antiguas. */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const lasting = await caches.open(LASTING);
    for (const key of await caches.keys()) {
      if (key === CACHE || key === LASTING) continue;
      if (key.startsWith("kanji-learning-")) {
        const old = await caches.open(key);
        for (const request of await old.keys()) {
          if (!isLasting(new URL(request.url)) || await lasting.match(request)) continue;
          const response = await old.match(request);
          if (response) await lasting.put(request, response);
        }
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !CACHEABLE.includes(new URL(request.url).origin)) return;

  // Lo que nunca cambia: la copia guardada y, si no la hay, la red (y se guarda)
  if (isLasting(new URL(request.url))) {
    event.respondWith(
      caches.open(LASTING).then(async (cache) => {
        const saved = await cache.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

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
