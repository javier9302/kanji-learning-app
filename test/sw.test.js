/* El service worker con una caché y una red de mentira: el diccionario de
   kuromoji se descarga una sola vez y sobrevive a una versión nueva de la app. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ORIGIN = "https://javier9302.github.io";
const SOURCE = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");

/* Un navegador mínimo: CacheStorage, fetch que cuenta descargas y los eventos del SW */
function browser(stores = new Map()) {
  const downloads = [];
  let online = true;
  const makeCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      match: async (request) => store.get(request.url ?? request)?.clone(),
      put: async (request, response) => { store.set(request.url ?? request, response); },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      addAll: async (list) => { for (const url of list) store.set(new URL(url, `${ORIGIN}/app/`).href, new Response("shell")); }
    };
  };
  const caches = {
    open: async (name) => makeCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => { for (const name of stores.keys()) { const hit = await makeCache(name).match(request); if (hit) return hit; } }
  };
  const listeners = {};
  const self = { location: { origin: ORIGIN }, addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const fetch = async (request) => {
    if (!online) throw new TypeError("Failed to fetch");
    downloads.push(request.url ?? request);
    return new Response(`body of ${request.url ?? request}`, { status: 200 });
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch, Response, URL, Promise, console });
  const run = async (type, extra = {}) => {
    let pending = null;
    const event = { ...extra, waitUntil: (p) => { pending = p; }, respondWith: (p) => { pending = p; } };
    listeners[type](event);
    return pending;
  };
  const get = async (url) => {
    const request = { url, method: "GET", mode: new URL(url).pathname.endsWith("/") ? "navigate" : "cors" };
    const answer = await run("fetch", { request });
    return answer ? await (await answer).text() : null; // null: el SW no la intercepta
  };
  return { stores, downloads, run, get, offline: () => { online = false; } };
}

const DICT = `${ORIGIN}/kanji-learning-app/vendor/kuromoji/dict/base.dat.gz`;
const APP = `${ORIGIN}/kanji-learning-app/app.js`;

test("el diccionario se descarga una vez; después sale de la copia guardada", async () => {
  const b = browser();
  await b.get(DICT);
  await b.get(DICT);
  await b.get(DICT);
  assert.equal(b.downloads.filter((url) => url === DICT).length, 1);
});

test("la app sigue pidiéndose primero a la red, para recibir siempre la última versión", async () => {
  const b = browser();
  await b.get(APP);
  await b.get(APP);
  assert.equal(b.downloads.filter((url) => url === APP).length, 2);
  b.offline();
  assert.equal(await b.get(APP), `body of ${APP}`); // sin conexión, la copia
});

test("una versión nueva de la app no vuelve a descargar el diccionario", async () => {
  // Un móvil con la versión anterior: el diccionario estaba en la caché de la app
  const stores = new Map([["kanji-learning-v12", new Map([[DICT, new Response("dict viejo")], [APP, new Response("app vieja")]])]]);
  const b = browser(stores);
  await b.run("install");
  await b.run("activate");
  assert.ok(!stores.has("kanji-learning-v12"));            // la copia antigua se borra…
  assert.equal(await b.get(DICT), "dict viejo");           // …pero el diccionario se conservó
  assert.equal(b.downloads.filter((url) => url === DICT).length, 0);
  // Y la siguiente versión tampoco lo borra: LASTING no se toca al activarse
  stores.set("kanji-learning-v99", new Map());
  await browser(stores).run("activate");
  assert.ok(stores.has("kanji-lasting-v1") && !stores.has("kanji-learning-v99"));
  assert.equal(await browser(stores).get(DICT), "dict viejo");
});

test("lo que se guarda para siempre: vendor/ y las librerías con versión; nada más", async () => {
  const b = browser();
  const lasting = [DICT, `${ORIGIN}/kanji-learning-app/vendor/ts-fsrs/index.umd.js`, "https://unpkg.com/wanakana@5.3.1/wanakana.min.js"];
  const fresh = [APP, `${ORIGIN}/kanji-learning-app/bank/n5.js`, `${ORIGIN}/kanji-learning-app/index.html`];
  for (const url of [...lasting, ...fresh]) { await b.get(url); await b.get(url); }
  for (const url of lasting) assert.equal(b.downloads.filter((u) => u === url).length, 1, url);
  for (const url of fresh) assert.equal(b.downloads.filter((u) => u === url).length, 2, url);
  // Supabase y la IA no pasan por el service worker
  assert.equal(await b.get("https://rilizudwepfmxbwrorxl.supabase.co/rest/v1/texts"), null);
});

test("la app abierta con ?add=… (palabras de la web) funciona sin conexión y no llena la caché", async () => {
  const b = browser();
  const HOME = `${ORIGIN}/kanji-learning-app/`;
  await b.get(`${HOME}?add=%E7%8C%AB&source=https%3A%2F%2Fa.jp%2F`);
  await b.get(`${HOME}?share_text=%E9%9B%A8`);
  const saved = [...b.stores.get("kanji-learning-v25").keys()].filter((url) => url.startsWith(HOME) && !url.slice(HOME.length).includes("."));
  assert.deepEqual(saved, [HOME]);                        // una sola copia de la página
  b.offline();
  assert.equal(await b.get(`${HOME}?add=%E7%8A%AC`), `body of ${HOME}?share_text=%E9%9B%A8`);
});
