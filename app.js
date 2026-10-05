/* =========================================
   KANJI LEARNING APP - app.js
   ========================================= */

const DB_NAME = "kanji-learning-app";
const DB_VERSION = 4;
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const PAGE_SIZE = 150;

let db;
let meta = { days: {}, deleted: {}, reading: {} }; // historial diario, borrados y perfil de lectura
let emptyStudyHTML = ""; // mensaje inicial de la pantalla de estudio

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Fecha LOCAL (toISOString usa UTC y adelanta/atrasa el día) */
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => isoDate(new Date());
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}


/* =========================================
   1. ALMACENAMIENTO LOCAL
   ========================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("items")) {
        const store = database.createObjectStore("items", { keyPath: "id" });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("level", "level", { unique: false });
        store.createIndex("nextReview", "nextReview", { unique: false });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
      // Lectura (reading.js): textos, diccionario, progreso por palabra y sesiones
      for (const name of READING_STORES) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/* Guarda y/o borra varios elementos en UNA sola transacción */
function writeItems(toSave = [], toDelete = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    toSave.forEach((item) => store.put(item));
    toDelete.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const saveItems = (list) => writeItems(Array.isArray(list) ? list : [list]);
const saveItem = saveItems;

async function loadMeta() {
  for (const row of await getAll("meta")) {
    if (row.key in meta && row.value && typeof row.value === "object") {
      meta[row.key] = row.value;
    }
  }
}

function saveMeta() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    for (const key of Object.keys(meta)) store.put({ key, value: meta[key] });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* Preferencias de este dispositivo (localStorage puede no estar disponible) */
function loadLocal(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return { ...fallback };
  }
}
function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* modo privado: se pierde al cerrar */ }
}

const prefs = loadLocal("kanji-prefs", {
  studyType: "word", studyLevel: "N5", studyMode: "type", studyCount: "10", goal: 20,
  furigana: "unknown" // furigana al leer: unknown | all | none
});

/* =========================================
   2. AUXILIARES
   ========================================= */

const normalizeText = (v) => String(v ?? "").trim().normalize("NFKC");
const isKanji = (c) => /\p{Script=Han}/u.test(c);
const splitKanji = (word) => [...new Set([...word].filter(isKanji))];

function splitInput(value) {
  return [...new Set(value.split(/[,，、;；\n\r]+/).map(normalizeText).filter(Boolean))];
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function shuffle(array) {
  const r = [...array];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/* katakana -> hiragana, sin puntos/guiones/espacios, para comparar lecturas */
function normalizeReading(value) {
  return normalizeText(value)
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[.\-\s・]/g, "");
}

const plural = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/* =========================================
   3. NAVEGACIÓN (delegación: sin listeners duplicados)
   ========================================= */

/* Secciones principales y las vistas que agrupa cada una */
const NAV = {
  study: ["read", "study", "draw"],
  library: ["library"],
  words: ["progress"],
  settings: ["data"]
};
// Vista que se abre al pulsar cada sección: la última usada
const lastView = {};

function switchView(name) {
  const group = Object.keys(NAV).find((g) => NAV[g].includes(name));
  lastView[group] = name;
  closeWordPop();

  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("hidden", v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.group === group));
  document.querySelectorAll(".subtabs").forEach((n) =>
    n.classList.toggle("hidden", n.dataset.group !== group));
  document.querySelectorAll(".subtab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name));
  document.body.dataset.view = name;
  if (name === "read") renderRead();
  if (name === "library") renderLibrary();
  if (name === "study") renderStudyHome();
  if (name === "draw") renderDraw();
  if (name === "progress") renderStats();
  if (name === "data") renderDataView();
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) return switchView(lastView[tab.dataset.group] || NAV[tab.dataset.group][0]);
    const go = event.target.closest(".subtab, [data-go]");
    if (go) switchView(go.dataset.view || go.dataset.go);
  });
}

/* =========================================
   4. INTERFAZ
   ========================================= */

function renderAll() {
  updateCounts();
  renderStats();
  renderDataView();
  // No se pisa una sesión en curso ni el resumen de la que acaba de terminar
  if (!session && !$("againBtn") && document.body.dataset.view === "study") renderStudyHome();
}

function currentStreak() {
  const d = new Date();
  if (!meta.days[isoDate(d)]?.r) d.setDate(d.getDate() - 1); // hoy aún puede completarse
  let streak = 0;
  while (meta.days[isoDate(d)]?.r) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function updateCounts() {
  const due = studyItems().filter(isDue);
  const done = meta.days[today()]?.r || 0;
  const goal = Math.max(1, Number(prefs.goal) || 20);

  $("dueBadge").textContent = plural(due.length, "pendiente", "pendientes");
  $("streakText").textContent = t("Racha: {n}", { n: plural(currentStreak(), "día", "días") });
  $("todayText").textContent = t("Hoy: {done} / {goal} repasos", { done, goal });
  $("todayBar").style.width = `${Math.min(100, (done / goal) * 100)}%`;
  $("todayBar").classList.toggle("complete", done >= goal);
}

/* =========================================
   7. ESTADÍSTICAS
   ========================================= */

function renderStats() {
  const items = studyItems();
  const studied = items;
  $("statTotal").textContent = items.length;
  $("statStudied").textContent = studied.length;
  $("statDue").textContent = studied.filter(isDue).length;
  $("statMature").textContent = items.filter((i) => i.status === "mature").length;
  $("statStreak").textContent = plural(currentStreak(), "día", "días");

  let reviews = 0, correct = 0;
  for (let i = 0; i < 30; i++) {
    const day = meta.days[daysFromNow(-i)];
    if (day) { reviews += day.r || 0; correct += day.c || 0; }
  }
  $("statAccuracy").textContent = reviews ? `${Math.round((correct / reviews) * 100)} %` : "—";

  renderForecast(studied);
  renderHeatmap();
  renderLevels(items);
  renderHardest(items);
  renderReadingStats();
}

function renderForecast(studied) {
  const days = Array.from({ length: 14 }, (_, i) => ({ date: daysFromNow(i), count: 0 }));
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const item of studied) {
    const i = item.nextReview <= days[0].date ? 0 : index.get(item.nextReview);
    if (i !== undefined) days[i].count++;
  }

  const max = Math.max(1, ...days.map((d) => d.count));
  const peak = days.findIndex((d) => d.count === max);

  $("forecastChart").innerHTML = days.map((d, i) => {
    const label = i === 0 ? t("Hoy") : formatDate(d.date);
    const tip = `${label}: ${plural(d.count, "repaso", "repasos")}`;
    return `
    <div class="bar-col" tabindex="0" data-tip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}">
      <span class="bar-value">${d.count && (i === 0 || i === peak) ? d.count : ""}</span>
      <div class="bar" style="height:${(d.count / max) * 100}%"></div>
      <span class="bar-label">${i === 0 ? t("Hoy") : i % 2 === 0 ? Number(d.date.slice(8)) : ""}</span>
    </div>`;
  }).join("");
}

function renderHeatmap() {
  const WEEKS = 16;
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7); // lunes
  const todayIso = today();
  const max = Math.max(1, ...Object.values(meta.days).map((d) => d.r || 0));

  let html = "";
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    if (iso > todayIso) { html += `<i class="heat-cell future"></i>`; continue; }
    const count = meta.days[iso]?.r || 0;
    const step = count ? Math.min(4, Math.ceil((count / max) * 4)) : 0;
    const tip = `${formatDate(iso)}: ${plural(count, "respuesta", "respuestas")}`;
    html += `<i class="heat-cell" data-heat="${step}" tabindex="0"
      data-tip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"></i>`;
  }
  $("heatmap").innerHTML = html;
}

function renderLevels(items) {
  const rows = LEVELS.map((level) => {
    const group = items.filter((i) => i.level === level);
    const mature = group.filter((i) => i.status === "mature").length;
    const learning = group.filter((i) => i.studied && i.status !== "mature").length;
    return { level, total: group.length, mature, learning, fresh: group.length - mature - learning };
  }).filter((row) => row.total);

  if (!rows.length) {
    $("levelChart").innerHTML = `<p class="helper">${t("Todavía no hay elementos.")}</p>`;
    return;
  }

  const segment = (cls, count, total, name) => {
    if (!count) return "";
    const tip = t("{name}: {count} de {total}", { name, count, total });
    return `<div class="seg ${cls}" style="flex-grow:${count}" tabindex="0"
        data-tip="${tip}" aria-label="${tip}"></div>`;
  };

  $("levelChart").innerHTML = rows.map((row) => `
    <div class="level-row">
      <span class="level-name">${row.level}</span>
      <div class="stack">
        ${segment("sw-mature", row.mature, row.total, t("Consolidados"))}
        ${segment("sw-learning", row.learning, row.total, t("Aprendiendo"))}
        ${segment("sw-new", row.fresh, row.total, t("Sin estudiar"))}
      </div>
      <span class="level-total">${row.mature + row.learning} / ${row.total}</span>
    </div>`).join("");
}

function renderHardest(items) {
  const hardest = items
    .filter((i) => i.incorrectCount > 0)
    .sort((a, b) => b.incorrectCount - a.incorrectCount || a.correctCount - b.correctCount)
    .slice(0, 8);

  $("hardList").innerHTML = hardest.length
    ? hardest.map((item) => `
      <div class="hard-item">
        <span class="hard-symbol" lang="ja">${escapeHTML(item.value)}</span>
        <span class="hard-reading">${escapeHTML(item.detail)}</span>
        <span class="hard-count">${plural(item.incorrectCount, "fallo", "fallos")}</span>
      </div>`).join("")
    : `<p class="helper">${t("Aquí aparecerán los elementos que más falles.")}</p>`;
}

/* =========================================
   ESCRITURA (trazos de KanjiVG)
   -----------------------------------------
   Cada kanji es un SVG de 109 × 109 con un <path> por trazo, en orden.
   Se busca primero en la carpeta kanjivg/ de la app y, si no está,
   en el repositorio de KanjiVG. El nombre es el código Unicode del
   kanji en hexadecimal con 5 cifras: 日 (U+65E5) -> 065e5.svg
   ========================================= */

const KVG_SOURCES = ["kanjivg/", "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/"];
const KVG_SIZE = 109;
const STROKE_SAMPLES = 12;
const STROKE_TOLERANCE = 15; // distancia media admitida, en unidades del SVG

const kvgFile = (kanji) => kanji.codePointAt(0).toString(16).padStart(5, "0") + ".svg";
const strokeCache = new Map(); // kanji -> lista de atributos "d"

async function fetchStrokes(kanji) {
  if (strokeCache.has(kanji)) return strokeCache.get(kanji);
  for (const base of KVG_SOURCES) {
    try {
      const response = await fetch(base + kvgFile(kanji));
      if (!response.ok) continue;
      const strokes = [...(await response.text()).matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)]
        .map((match) => match[1]);
      if (!strokes.length) continue;
      strokeCache.set(kanji, strokes);
      return strokes;
    } catch { /* se prueba la siguiente fuente */ }
  }
  throw new Error(t("No se encontró {file}", { file: kvgFile(kanji) }));
}

/* n puntos repartidos a distancias iguales a lo largo del trazo dibujado */
function resample(points, n = STROKE_SAMPLES) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] +
      Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = lengths[lengths.length - 1];
  if (!total) return Array(n).fill(points[0]);

  const result = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const at = (total * i) / (n - 1);
    while (j < points.length - 1 && lengths[j] < at) j++;
    const t = (at - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1);
    result.push([
      points[j - 1][0] + (points[j][0] - points[j - 1][0]) * t,
      points[j - 1][1] + (points[j][1] - points[j - 1][1]) * t
    ]);
  }
  return result;
}

function samplePath(path, n = STROKE_SAMPLES) {
  const length = path.getTotalLength();
  return Array.from({ length: n }, (_, i) => {
    const point = path.getPointAtLength((length * i) / (n - 1));
    return [point.x, point.y];
  });
}

const meanDistance = (a, b) =>
  a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / a.length;

/* Compara lo dibujado con el trazo esperado: "ok", "reversed" o "no" */
function matchStroke(points, path) {
  const user = resample(points);
  const target = samplePath(path);
  const forward = meanDistance(user, target);
  const backward = meanDistance(user, [...target].reverse());

  // En un punto o trazo muy corto solo importa la posición
  if (path.getTotalLength() < 14) {
    return Math.min(forward, backward) <= STROKE_TOLERANCE ? "ok" : "no";
  }
  if (forward <= STROKE_TOLERANCE && forward <= backward) return "ok";
  return backward <= STROKE_TOLERANCE ? "reversed" : "no";
}

/* =========================================
   14. CUENTA Y SINCRONIZACIÓN (Supabase)
   -----------------------------------------
   La app trabaja siempre con su copia local (IndexedDB), así funciona
   sin conexión y sin cuenta. Con la sesión iniciada, cada sincronización:
     1. descarga las filas cambiadas desde la última vez (updated_at del
        servidor) y las combina: gana la modificada más recientemente;
     2. sube los elementos locales que el servidor aún no tiene así.
   `sync.pushed` recuerda la "huella" de lo que ya hay en el servidor
   para saber qué falta por subir.
   ========================================= */

const SYNC_PAGE = 1000;  // filas por descarga (máximo de Supabase por petición)
const SYNC_BATCH = 500;  // filas por subida
const SYNC_DEFAULT = { userId: "", cursor: "", daysCursor: "", cursors: {}, lastSync: 0 };
// Huellas de lo que ya está en el servidor (las de lectura las usa reading.js)
const blankPushed = () =>
  ({ days: {}, texts: {}, states: {}, words: {}, kanji: {}, sessions: {}, profile: "" });

const accountsReady = typeof SUPABASE_CONFIG === "object" &&
  /^https:\/\/.+/.test(SUPABASE_CONFIG.url) &&
  !SUPABASE_CONFIG.url.includes("TU-PROYECTO") &&
  !!SUPABASE_CONFIG.anonKey && !SUPABASE_CONFIG.anonKey.includes("TU-CLAVE");

// Sin conexión en la primera visita la librería puede no haberse cargado
const sb = accountsReady && window.supabase
  // Solo el origen: si se pegó la URL de la API (…/rest/v1/) se ignora la ruta
  ? window.supabase.createClient(new URL(SUPABASE_CONFIG.url).origin, SUPABASE_CONFIG.anonKey)
  : null;

const sync = {
  config: loadLocal("kanji-sync", SYNC_DEFAULT),
  pushed: loadLocal("kanji-pushed", blankPushed()),
  user: null,
  running: false,
  queued: false,
  timer: null
};

// Restos de la antigua sincronización con GitHub: el token ya no se usa
if ("token" in sync.config) {
  sync.config = { ...SYNC_DEFAULT, lastSync: sync.config.lastSync || 0 };
  saveLocal("kanji-sync", sync.config);
}

function setSyncState(state, message = "") {
  const labels = {
    off: sb ? t("Iniciar sesión") : t("Solo en este dispositivo"),
    syncing: t("Sincronizando…"),
    ok: t("Sincronizado"),
    offline: t("Sin conexión"),
    error: t("Error al sincronizar")
  };
  $("syncBtn").dataset.state = state;
  $("syncLabel").textContent = labels[state];
  $("syncBtn").title = message || (sync.user ? sync.user.email : labels[state]);
  $("syncMessage").textContent = message;
  $("syncMessage").classList.toggle("incorrect", state === "error");
  $("footerNote").textContent = state === "off"
    ? t("Datos guardados localmente en este navegador")
    : t("Datos guardados en este navegador y en tu cuenta");
}

const whole = (value) => Math.max(0, Math.round(Number(value) || 0));
const dayPrint = (day) => `${day.r || 0},${day.c || 0},${day.n || 0}`;

/* Filas del usuario cambiadas desde `cursor`, de página en página */
async function fetchChanged(table, key, userId, cursor, ownOnly = true) {
  const rows = [];
  for (let from = 0; ; from += SYNC_PAGE) {
    let query = sb.from(table).select("*");
    if (ownOnly) query = query.eq("user_id", userId); // si no, lo que permita Row Level Security
    query = query.order("updated_at").order(key).range(from, from + SYNC_PAGE - 1);
    if (cursor) query = query.gt("updated_at", cursor);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < SYNC_PAGE) return rows;
  }
}

/* Historial diario: el máximo de cada contador, como al importar */
async function pullDays(userId) {
  const rows = await fetchChanged("days", "day", userId, sync.config.daysCursor);
  if (!rows.length) return;

  let changed = false;
  for (const row of rows) {
    const theirs = { r: row.reviews, c: row.correct, n: row.new_items };
    sync.pushed.days[row.day] = dayPrint(theirs);
    const mine = meta.days[row.day] || {};
    const merged = {
      r: Math.max(mine.r || 0, theirs.r || 0),
      c: Math.max(mine.c || 0, theirs.c || 0),
      n: Math.max(mine.n || 0, theirs.n || 0)
    };
    if (dayPrint(merged) !== dayPrint(mine)) { meta.days[row.day] = merged; changed = true; }
  }
  if (changed) {
    await saveMeta();
    renderAll();
  }
  sync.config.daysCursor = rows[rows.length - 1].updated_at;
}

async function pushRows(table, conflict, rows, marks, pushed, options = {}) {
  for (let i = 0; i < rows.length; i += SYNC_BATCH) {
    const { error } = await sb.from(table)
      .upsert(rows.slice(i, i + SYNC_BATCH), { onConflict: conflict, ...options });
    if (error) throw error;
    for (const [key, print] of marks.slice(i, i + SYNC_BATCH)) pushed[key] = print;
  }
}

async function pushDays(userId) {
  const rows = [], marks = [];
  for (const [day, counts] of Object.entries(meta.days)) {
    const print = dayPrint(counts);
    if (sync.pushed.days[day] === print || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    rows.push({
      user_id: userId, day,
      reviews: whole(counts.r), correct: whole(counts.c), new_items: whole(counts.n)
    });
    marks.push([day, print]);
  }
  await pushRows("days", "user_id,day", rows, marks, sync.pushed.days);
}

// supabase-js devuelve los fallos de red como un error con este texto; un TypeError
// lanzado por nuestro código es un fallo real y debe verse como tal
const isNetworkError = (error) =>
  !navigator.onLine || /failed to fetch|networkerror|load failed/i.test(error?.message || "");

function syncErrorMessage(error) {
  if (["PGRST205", "42P01"].includes(error.code)) {
    return t("Faltan las tablas en Supabase: ejecuta supabase/schema.sql.");
  }
  return t("No se pudo sincronizar ({error}).", { error: error.message || error.code || "?" });
}

async function syncNow() {
  clearTimeout(sync.timer);
  sync.timer = null;
  if (!sb || !sync.user) return;
  if (sync.running) { sync.queued = true; return; }
  if (!navigator.onLine) return setSyncState("offline");

  sync.running = true;
  setSyncState("syncing");
  const userId = sync.user.id;

  try {
    await pullDays(userId);
    // Si mientras tanto se cerró la sesión, no se sube nada
    if (sync.user?.id === userId) {
      await pushDays(userId);
      await pullReading(userId);
      if (sync.user?.id === userId) await pushReading(userId);
    }

    sync.config.lastSync = Date.now();
    setSyncState("ok", t("Última sincronización: {time}.", {
      time: new Date().toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) }));
  } catch (error) {
    console.error("Error de sincronización:", error);
    if (isNetworkError(error)) setSyncState("offline");
    else setSyncState("error", syncErrorMessage(error));
  } finally {
    // Lo ya subido o descargado se recuerda aunque el resto fallara
    saveLocal("kanji-sync", sync.config);
    saveLocal("kanji-pushed", sync.pushed);
    sync.running = false;
    if (!sync.user) setSyncState("off");
    renderDataView();
    if (sync.queued) {
      sync.queued = false;
      scheduleSync();
    }
  }
}

/* Agrupa los cambios seguidos en una sola subida */
function scheduleSync(delay = 4000) {
  if (!sync.user) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, delay);
}

/* ---------- Sesión ---------- */

function resetSyncMemory(userId) {
  sync.config = { ...SYNC_DEFAULT, cursors: {}, userId };
  sync.pushed = blankPushed();
  saveLocal("kanji-sync", sync.config);
  saveLocal("kanji-pushed", sync.pushed);
}

/* Vacía la copia local (los datos de otra cuenta no se mezclan con esta) */
async function clearLocalData() {
  session = null;
  draw = null;
  document.body.classList.remove("studying");
  await writeItems([], (await getAll("items")).map((i) => i.id)); // repaso del modelo antiguo
  meta.days = {};
  meta.deleted = {};
  meta.reading = {};
  reader = placement = evaluation = null;
  await saveMeta();
  await clearReadingData();
  $("studyArea").innerHTML = emptyStudyHTML;
  renderAll();
}

/* Se llama al iniciar sesión (o al abrir la app con la sesión guardada) */
async function adoptUser(user) {
  const owner = sync.config.userId;

  if (owner && owner !== user.id) {
    const hasData = userWords.size || texts.length || Object.keys(meta.days).length;
    if (hasData && !confirm(t("Este dispositivo tiene datos de otra cuenta. Para continuar se quitarán de este dispositivo (lo que no se hubiera sincronizado se perderá). ¿Continuar?"))) {
      sync.user = null;
      await sb.auth.signOut({ scope: "local" });
      return;
    }
    if (hasData) await clearLocalData();
  }
  // Sin dueño anterior: el progreso local (modo invitado) se sube a la cuenta
  if (owner !== user.id) resetSyncMemory(user.id);

  if (["login", "signup"].includes(authMode)) $("authDialog").close();
  setSyncState("ok");
  renderDataView();
  checkAdmin();
  await syncNow();
}

function onAuthChange(event, authSession) {
  const user = authSession?.user || null;
  const same = (user?.id || "") === (sync.user?.id || "");
  sync.user = user;

  if (event === "PASSWORD_RECOVERY") openAuth("newpass");
  if (same) return; // solo se renovó la sesión
  if (user) return adoptUser(user);

  clearTimeout(sync.timer);
  sync.isAdmin = false;
  setSyncState("off");
  renderDataView();
}

/* Cerrar sesión nunca se bloquea: se intenta subir lo pendiente unos segundos
   y, si no se puede, se queda en el dispositivo para la próxima vez. */
async function signOut() {
  $("signOutBtn").disabled = true;
  await Promise.race([syncNow(), sleep(4000)]);
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) console.error("Error al cerrar sesión:", error);
  $("signOutBtn").disabled = false;
}

/* El permiso lo decide la base de datos; aquí solo se muestra el enlace al panel */
async function checkAdmin() {
  const { data, error } = await sb.rpc("is_admin");
  sync.isAdmin = !error && data === true;
  sync.pendingTexts = 0;
  if (sync.isAdmin) {
    // Cuántos textos esperan aprobación, para avisar en el botón del panel
    const { count } = await sb.from("texts").select("id", { count: "exact", head: true })
      .eq("status", "pending").is("deleted_at", null);
    sync.pendingTexts = count || 0;
  }
  renderDataView();
}

/* ---------- Diálogo de cuenta ---------- */

let authMode = "";

const authModes = () => ({
  login: { title: t("Iniciar sesión"), submit: t("Entrar"), email: true, password: true,
    sub: t("Tu progreso se guarda en tu cuenta y se mantiene al día en todos tus dispositivos.") },
  signup: { title: t("Crear cuenta"), submit: t("Crear cuenta"), email: true, password: true,
    sub: t("El progreso que ya tienes en este dispositivo se guardará en tu cuenta.") },
  reset: { title: t("Recuperar contraseña"), submit: t("Enviar enlace"), email: true,
    sub: t("Te enviaremos un enlace para elegir una contraseña nueva.") },
  newpass: { title: t("Nueva contraseña"), submit: t("Guardar contraseña"), password: true,
    sub: t("Escribe la contraseña nueva para tu cuenta.") }
});

function authSay(text, cls = "") {
  $("authMessage").textContent = text;
  $("authMessage").className = `message ${cls}`;
}

function openAuth(mode = "login") {
  const view = authModes()[mode];
  authMode = mode;
  $("authTitle").textContent = view.title;
  $("authSub").textContent = view.sub;
  $("authSubmitBtn").textContent = view.submit;
  $("authSubmitBtn").disabled = false;

  $("authEmailField").classList.toggle("hidden", !view.email);
  $("authEmail").disabled = !view.email;
  $("authPasswordField").classList.toggle("hidden", !view.password);
  $("authPassword").disabled = !view.password;
  $("authPassword").value = "";
  $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authPasswordLabel").textContent =
    mode === "login" ? t("Contraseña") : t("Contraseña (mínimo 8 caracteres)");

  $("authGoogleBtn").classList.toggle("hidden",
    !SUPABASE_CONFIG.google || !["login", "signup"].includes(mode));
  $("authToSignup").classList.toggle("hidden", mode !== "login");
  $("authToLogin").classList.toggle("hidden", !["signup", "reset"].includes(mode));
  $("authToReset").classList.toggle("hidden", mode !== "login");

  authSay("");
  if (!$("authDialog").open) $("authDialog").showModal();
  (view.email ? $("authEmail") : $("authPassword")).focus();
}

/* Mensajes claros para los errores de Supabase Auth */
function authErrorMessage(error) {
  const code = error.code || "";
  const text = error.message || "";
  if (error.name === "AuthRetryableFetchError" || /fetch|network/i.test(text)) {
    return t("No hay conexión. Inténtalo de nuevo cuando tengas internet.");
  }
  if (code === "invalid_credentials" || /invalid login/i.test(text)) {
    return t("Correo o contraseña incorrectos.");
  }
  if (code === "email_not_confirmed") {
    return t("Confirma tu correo con el enlace que te enviamos antes de entrar.");
  }
  if (["user_already_exists", "email_exists"].includes(code)) {
    return t("Ya existe una cuenta con ese correo. Inicia sesión o recupera la contraseña.");
  }
  if (code === "weak_password") {
    return t("La contraseña es demasiado débil. Usa al menos 8 caracteres.");
  }
  if (code === "same_password") {
    return t("La contraseña nueva debe ser distinta de la anterior.");
  }
  if (["email_address_invalid", "validation_failed"].includes(code)) {
    return t("Revisa el correo: no parece válido.");
  }
  if (error.status === 429 || /rate_limit/.test(code)) {
    return t("Demasiados intentos. Espera unos minutos y vuelve a probar.");
  }
  if (code === "signup_disabled") {
    return t("El registro de cuentas nuevas está desactivado.");
  }
  return t("No se pudo completar la operación ({error}).", { error: text || code || "?" });
}

async function submitAuth(event) {
  event.preventDefault();
  const mode = authMode;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  // Los enlaces de los correos vuelven a esta misma página
  const redirectTo = location.origin + location.pathname;

  $("authSubmitBtn").disabled = true;
  authSay(t("Un momento…"));

  try {
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      // Con un correo ya registrado Supabase responde sin error y sin identidades
      if (data.user && data.user.identities?.length === 0) throw { code: "user_already_exists" };
      if (!data.session) {
        authSay(t("Te enviamos un correo. Abre el enlace para confirmar la cuenta y luego inicia sesión."), "correct");
        return;
      }
    } else if (mode === "reset") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      authSay(t("Si hay una cuenta con ese correo, recibirás un enlace para cambiar la contraseña."), "correct");
      return;
    } else {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      $("authDialog").close();
      $("syncMessage").textContent = t("Contraseña actualizada.");
    }
  } catch (error) {
    authSay(authErrorMessage(error), "incorrect");
  } finally {
    $("authSubmitBtn").disabled = false;
  }
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) authSay(authErrorMessage(error), "incorrect");
}

function renderDataView() {
  const signedIn = !!sync.user;
  $("accountDisabled").classList.toggle("hidden", !!sb);
  $("accountGuest").classList.toggle("hidden", !sb || signedIn);
  $("accountActive").classList.toggle("hidden", !signedIn);
  if (signedIn) {
    const { email, created_at: since } = sync.user;
    $("profileAvatar").textContent = (email || "?")[0].toUpperCase();
    $("profileEmail").textContent = email;
    $("profileSince").textContent = since ? t("Estudiante desde {date}", {
      date: new Date(since).toLocaleDateString(lang, { month: "long", year: "numeric" }) }) : "";
    $("profileLevel").textContent = meta.reading.level || "—";
    $("profileMastered").textContent = [...userWords.values()].filter((w) => w.status === "mastered").length;
    $("profileTexts").textContent = texts.filter((x) => x.readAt).length;
    $("profileKanji").textContent = [...userKanji.values()].filter((k) => k.knowsMeaning || k.canWrite).length;
  }
  $("adminLink").classList.toggle("hidden", !signedIn || !sync.isAdmin);
  $("adminLink").textContent = t("Panel de administración") +
    (sync.pendingTexts ? ` (${plural(sync.pendingTexts, "pendiente", "pendientes")})` : "");
  $("accountDisabled").textContent = accountsReady
    ? t("No se pudo cargar el servicio de cuentas. Comprueba la conexión y vuelve a abrir la app.")
    : t("Las cuentas no están configuradas en esta instalación (falta rellenar config.js).");
  $("syncNowBtn").disabled = sync.running;

}

function bindSync() {
  $("syncNowBtn").addEventListener("click", syncNow);
  $("syncBtn").addEventListener("click", () =>
    !sync.user && sb ? openAuth("login") : switchView("data"));
  if (!sb) return;

  $("accountOpenBtn").addEventListener("click", () => openAuth("login"));
  $("signOutBtn").addEventListener("click", signOut);
  $("changePasswordBtn").addEventListener("click", () => openAuth("newpass"));
  $("authForm").addEventListener("submit", submitAuth);
  $("authCancelBtn").addEventListener("click", () => $("authDialog").close());
  $("authGoogleBtn").addEventListener("click", signInWithGoogle);
  $("authToSignup").addEventListener("click", () => openAuth("signup"));
  $("authToLogin").addEventListener("click", () => openAuth("login"));
  $("authToReset").addEventListener("click", () => openAuth("reset"));

  // Supabase no permite llamar a su API dentro de este aviso: se aplaza
  sb.auth.onAuthStateChange((event, authSession) =>
    setTimeout(() => onAuthChange(event, authSession), 0));

  window.addEventListener("online", syncNow);
  window.addEventListener("offline", () => sync.user && setSyncState("offline"));

  // Al volver a la app se recogen los cambios hechos en otros dispositivos;
  // al salir se suben los que estuvieran pendientes.
  document.addEventListener("visibilitychange", () => {
    if (!sync.user) return;
    if (document.visibilityState === "hidden") {
      if (sync.timer) syncNow();
    } else if (Date.now() - sync.config.lastSync > 60000) {
      syncNow();
    }
  });
}

/* =========================================
   15. EVENTOS
   ========================================= */

function bindSettings() {
  for (const id of ["studyType", "studyLevel", "studyMode", "studyCount"]) {
    if ([...$(id).options].some((o) => o.value === String(prefs[id]))) $(id).value = prefs[id];
    $(id).addEventListener("change", () => {
      prefs[id] = $(id).value;
      saveLocal("kanji-prefs", prefs);
      renderStudyHome();
    });
  }

  $("goalInput").value = prefs.goal;
  $("goalInput").addEventListener("change", () => {
    prefs.goal = Math.min(500, Math.max(1, Math.round(Number($("goalInput").value)) || 20));
    $("goalInput").value = prefs.goal;
    saveLocal("kanji-prefs", prefs);
    updateCounts();
  });

  $("drawLevel").addEventListener("change", () => { draw = null; renderDraw(); });
  $("startBtn").addEventListener("click", startSession);
}

/* =========================================
   16. INICIO
   ========================================= */

async function init() {
  try {
    db = await openDatabase();
    await loadMeta();
    await loadReadingData();
    await loadStudyData();
  } catch (error) {
    console.error("Error al iniciar la aplicación:", error);
    $("readArea").innerHTML = `
      <div class="empty-state">
        <h3>${t("No se pudo abrir el almacenamiento local")}</h3>
        <p>${t("Abre la aplicación desde un navegador compatible con IndexedDB.")}</p>
      </div>`;
    return;
  }

  // El banco hasta el nivel del estudiante; el resto se descarga cuando hace falta.
  // Sin conexión en la primera visita puede fallar: la app sigue y lo reintenta al usarlo.
  await BANK.loadUpTo(meta.reading.level || "N5").catch(() => {});
  await migrateOldItems().catch((error) => console.error("Error al migrar el progreso:", error));

  emptyStudyHTML = $("studyArea").innerHTML;
  bindNavigation();
  bindShortcuts();
  bindSettings();
  bindLibrary();
  bindReader();
  bindReadingStats();
  bindSync();

  setSyncState("off");
  renderAll();
  switchView("read"); // la lectura es la pantalla principal

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
