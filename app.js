/* =========================================
   KANJI LEARNING APP - app.js
   ========================================= */

const DB_NAME = "kanji-learning-app";
const DB_VERSION = 2;
const DICT_VERSION = 2; // sube este número para forzar nuevas consultas
const SCHEMA_VERSION = 2;
const GIST_FILE = "kanji-learning-data.json";
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const PAGE_SIZE = 150;

let db;
let items = [];
let meta = { days: {}, deleted: {} }; // historial diario y elementos borrados
let session = null;
let pendingImport = null;
let listLimit = PAGE_SIZE;
let editingItem = null;

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

const uid = (type, value) => `${type}:${value.normalize("NFKC")}`;

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
  studyType: "kanji", studyLevel: "N3", studyMode: "type", studyCount: "10", goal: 20
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

const hasReadings = (item) =>
  item.dictionary?.v === DICT_VERSION && item.dictionary.readings?.length > 0;
const isDue = (item) => item.studied && item.nextReview <= today();

/* Lecturas que se aceptan como respuesta. En los kanjis solo valen las kun;
   si el kanji no tiene ninguna (o la lectura se escribió a mano) valen todas. */
function acceptedReadings(item) {
  const { readings, display } = item.dictionary;
  if (item.type !== "kanji" || display.imported?.length || !display.kun?.length) return readings;
  return [...new Set(display.kun
    .flatMap((r) => [normalizeReading(r), normalizeReading(r.split(".")[0])])
    .filter(Boolean))];
}

/* Un kanji está aprendido cuando se ha acertado al menos una vez */
const isLearned = (item) => item.type === "kanji" && item.correctCount > 0;
const learnedKanji = () => new Set(items.filter(isLearned).map((i) => i.value));

/* Una palabra solo se estudia cuando todos sus kanjis están aprendidos */
const isUnlocked = (item, learned) =>
  item.type !== "word" || splitKanji(item.value).every((k) => learned.has(k));
const plural = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/* Lecturas tal y como se muestran al usuario */
function displayReadings(item) {
  const display = item.dictionary?.display;
  if (!display) return [];
  if (item.type !== "kanji") return display.words || [];
  return display.imported?.length
    ? display.imported
    : [...(display.on || []), ...(display.kun || [])];
}

/* =========================================
   3. NAVEGACIÓN (delegación: sin listeners duplicados)
   ========================================= */

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("hidden", v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name));
  document.body.dataset.view = name;
  if (name === "draw") renderDraw();
  if (name === "manage") renderItems();
  if (name === "progress") renderStats();
  if (name === "data") renderDataView();
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) return switchView(tab.dataset.view);
    const go = event.target.closest("[data-go]");
    if (go) switchView(go.dataset.go);
  });
}

/* =========================================
   4. INTERFAZ
   ========================================= */

/* Sustituye `items` conservando los mismos objetos, para que la sesión
   en curso y las consultas al diccionario nunca trabajen con copias obsoletas */
function adoptItems(list) {
  const current = new Map(items.map((i) => [i.id, i]));
  items = list.map((record) => {
    const existing = current.get(record.id);
    if (!existing || existing === record) return record;
    for (const key of Object.keys(existing)) delete existing[key];
    return Object.assign(existing, record);
  });
}

function renderAll() {
  updateCounts();
  renderBaseLists();
  renderItems();
  renderStats();
  renderDataView();
  // No se pisa una sesión en curso ni el resumen de la que acaba de terminar
  if (!session && !$("againBtn")) renderStudyHome();
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
  const learned = learnedKanji();
  const due = items.filter((i) => isDue(i) && isUnlocked(i, learned));
  const done = meta.days[today()]?.r || 0;
  const goal = Math.max(1, Number(prefs.goal) || 20);

  $("itemCount").textContent = plural(items.length, "elemento", "elementos");
  $("dueBadge").textContent = plural(due.length, "pendiente", "pendientes");
  $("streakText").textContent = t("Racha: {n}", { n: plural(currentStreak(), "día", "días") });
  $("todayText").textContent = t("Hoy: {done} / {goal} repasos", { done, goal });
  $("todayBar").style.width = `${Math.min(100, (done / goal) * 100)}%`;
  $("todayBar").classList.toggle("complete", done >= goal);
}

function matchesStudyFilter(item) {
  const type = $("studyType").value;
  const level = $("studyLevel").value;
  return (type === "mixed" || item.type === type) &&
    (level === "ALL" || item.level === level);
}

function renderStudyHome() {
  if (!items.length) return; // se queda el mensaje inicial del HTML
  const learned = learnedKanji();
  const matching = items.filter(matchesStudyFilter);
  const candidates = matching.filter((i) => isUnlocked(i, learned));
  const locked = matching.length - candidates.length;
  const due = candidates.filter(isDue).length;
  const fresh = candidates.filter((i) => !i.studied).length;
  const lockedNote = locked
    ? " " + t("{n} hasta que aciertes sus kanjis.",
        { n: plural(locked, "palabra bloqueada", "palabras bloqueadas") })
    : "";

  $("studyArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">学</div>
      <h3>${candidates.length
        ? `${plural(due, "repaso pendiente", "repasos pendientes")} · ${plural(fresh, "nuevo", "nuevos")}`
        : t("No hay elementos en esta selección")}</h3>
      <p>${candidates.length
        ? t("{n} con estos filtros. Pulsa “Iniciar repaso” para empezar.",
            { n: plural(candidates.length, "elemento", "elementos") }) + lockedNote
        : locked
          ? t("Las palabras se desbloquean cuando aciertas al menos una vez todos sus kanjis.") + lockedNote
          : t("Cambia el contenido o el nivel, o agrega más elementos en “Mis listas”.")}</p>
    </div>`;
}

/* =========================================
   5. AGREGAR ELEMENTOS
   ========================================= */

function newItem(type, value, level) {
  return {
    id: uid(type, value),
    type, value, level,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    source: "user-list",
    dictionary: null,
    lookupStatus: "pending",
    studied: false,
    correctCount: 0,
    incorrectCount: 0,
    repetitions: 0,
    interval: 0,
    ease: 2.5,
    lastReviewed: null,
    nextReview: today(),
    status: "new"
  };
}

async function addList() {
  const type = $("importType").value;
  const level = $("importLevel").value;
  const values = splitInput($("listInput").value);

  if (!values.length) {
    $("addMessage").textContent = t("Introduce al menos un elemento.");
    return;
  }

  const known = new Set(items.map((i) => i.id));
  const toSave = [];
  let skipped = 0, invalid = 0, derived = 0;

  for (const value of values) {
    if (type === "kanji" && ([...value].length !== 1 || !isKanji(value))) {
      invalid++;
      continue;
    }
    const id = uid(type, value);
    if (known.has(id)) { skipped++; continue; }
    known.add(id);
    toSave.push(newItem(type, value, level));

    // Las palabras también crean sus kanjis
    if (type === "word") {
      for (const ch of splitKanji(value)) {
        const kid = uid("kanji", ch);
        if (known.has(kid)) continue;
        known.add(kid);
        const k = newItem("kanji", ch, level);
        k.source = "derived-from-word";
        toSave.push(k);
        derived++;
      }
    }
  }

  if (toSave.length) {
    await saveItems(toSave);
    items.push(...toSave);
  }

  $("listInput").value = "";
  $("addMessage").textContent =
    t("Agregados: {n}", { n: toSave.length - derived }) +
    (derived ? t(" (+{n} kanjis derivados)", { n: derived }) : "") +
    t(". Ya existentes: {n}.", { n: skipped }) +
    (invalid ? t(" Formato no válido: {n}.", { n: invalid }) : "");

  renderAll();
  scheduleSync();
  runLookups();
}

/* ---------- Listas base JLPT (jlpt-lists.js) ---------- */

const BASE_LABEL = {
  kanji: ["kanjis", "kanji agregado", "kanjis agregados"],
  word: ["palabras", "palabra agregada", "palabras agregadas"]
};

function baseList(type, level) {
  return type === "kanji"
    ? [...JLPT_KANJI[level]]
    : JLPT_WORDS[level].split(",");
}

function renderBaseLists() {
  const known = new Set(items.map((i) => i.id));
  $("baseLists").innerHTML = Object.keys(BASE_LABEL).map((type) => `
    <p class="base-title">${type === "kanji" ? t("Kanjis") : t("Palabras")}</p>
    <div class="base-row">${LEVELS.map((level) => {
      const list = baseList(type, level);
      const missing = list.filter((v) => !known.has(uid(type, v))).length;
      const name = t(BASE_LABEL[type][0]);
      return `
      <button class="button button-outline" data-base="${type}:${level}" type="button"${missing ? "" : " disabled"}>
        <strong>${level}</strong>
        <span>${!missing ? t("{n} {name} · agregada", { n: list.length, name })
          : missing === list.length ? t("Agregar {n} {name}", { n: list.length, name })
          : t("Agregar {n} restantes", { n: missing })}</span>
      </button>`;
    }).join("")}</div>`).join("");
}

async function addBaseList(type, level) {
  const known = new Set(items.map((i) => i.id));
  const toSave = [];

  for (const value of baseList(type, level)) {
    if (known.has(uid(type, value))) continue;
    const item = newItem(type, value, level);
    item.source = "base-list";
    toSave.push(item);
  }

  if (toSave.length) {
    await saveItems(toSave);
    items.push(...toSave);
  }

  const [, one, many] = BASE_LABEL[type];
  $("baseMessage").textContent =
    t("Lista {level}: {n}.", { level, n: plural(toSave.length, one, many) }) +
    (type === "word" ? " " + t("Cada palabra aparecerá en los repasos cuando hayas acertado sus kanjis.") : "");

  renderAll();
  scheduleSync();
  runLookups();
}

/* =========================================
   6. LISTA DE ELEMENTOS
   ========================================= */

function itemState(item) {
  if (!item.studied) return t("Sin estudiar");
  if (item.nextReview <= today()) return t("Repasar hoy");
  return t("Próximo: {date}", { date: formatDate(item.nextReview) });
}

function filteredItems() {
  const text = normalizeText($("filterInput").value).toLowerCase();
  const kana = normalizeReading(text);
  const type = $("filterType").value;
  const level = $("filterLevel").value;
  const status = $("filterStatus").value;

  return items.filter((i) => {
    if (type && i.type !== type) return false;
    if (level && i.level !== level) return false;
    if (status === "due" && !isDue(i)) return false;
    if (status === "new" && i.studied) return false;
    if (status === "learning" && !(i.studied && i.status !== "mature")) return false;
    if (status === "mature" && i.status !== "mature") return false;
    if (status === "nodict" && hasReadings(i)) return false;
    if (!text) return true;
    return i.value.toLowerCase().includes(text) ||
      (i.dictionary?.readings || []).some((r) => kana && r.includes(kana)) ||
      (i.dictionary?.meanings || []).some((m) => String(m).toLowerCase().includes(text));
  });
}

function renderItems() {
  const list = $("itemsList");
  $("moreBtn").classList.add("hidden");

  if (!items.length) {
    list.innerHTML = `<div class="no-items">${t("Todavía no has agregado kanjis ni palabras.")}</div>`;
    return;
  }

  const filtered = filteredItems().sort((a, b) => a.value.localeCompare(b.value, "ja"));

  if (!filtered.length) {
    list.innerHTML = `<div class="no-items">${t("No se encontraron elementos.")}</div>`;
    return;
  }

  list.innerHTML = filtered.slice(0, listLimit).map((item) => {
    const readings = displayReadings(item);
    const info = readings.length
      ? escapeHTML(readings.slice(0, 4).join(" · "))
      : item.lookupStatus === "error" ? t("No se pudo consultar") : t("Información pendiente");
    const meanings = (item.dictionary?.meanings || []).slice(0, 3).join(", ");
    return `
    <article class="item-row">
      <div class="item-symbol">${escapeHTML(item.value)}</div>
      <div class="item-info">
        <div class="item-title">${info}</div>
        <div class="item-sub">
          ${item.type === "kanji" ? "Kanji" : t("Palabra")} · ${escapeHTML(item.level)}${
            meanings ? ` · ${escapeHTML(meanings)}` : ""}
        </div>
      </div>
      <div class="item-state">${itemState(item)}</div>
      <button class="icon-btn" data-edit="${escapeHTML(item.id)}"
        title="${t("Editar")}" aria-label="${t("Editar")} ${escapeHTML(item.value)}">✎</button>
      <button class="icon-btn delete-btn" data-delete="${escapeHTML(item.id)}"
        title="${t("Eliminar")}" aria-label="${t("Eliminar")} ${escapeHTML(item.value)}">×</button>
    </article>`;
  }).join("");

  if (filtered.length > listLimit) {
    $("moreBtn").classList.remove("hidden");
    $("moreBtn").textContent = t("Mostrar más ({n} restantes)", { n: filtered.length - listLimit });
  }
}

async function deleteItem(item) {
  meta.deleted[item.id] = Date.now(); // para que la sincronización no lo recupere
  items = items.filter((i) => i !== item);
  await writeItems([], [item.id]);
  await saveMeta();
  renderAll();
  scheduleSync();
}

/* Un único listener para todos los botones de la lista */
function bindList() {
  $("itemsList").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit]");
    if (edit) return openEditor(items.find((i) => i.id === edit.dataset.edit));

    const button = event.target.closest("[data-delete]");
    if (!button) return;
    const item = items.find((i) => i.id === button.dataset.delete);
    if (item && confirm(t("¿Eliminar {value} y su progreso?", { value: item.value }))) await deleteItem(item);
  });

  const resetAndRender = () => { listLimit = PAGE_SIZE; renderItems(); };
  $("filterInput").addEventListener("input", resetAndRender);
  for (const id of ["filterType", "filterLevel", "filterStatus"]) {
    $(id).addEventListener("change", resetAndRender);
  }
  $("moreBtn").addEventListener("click", () => { listLimit += PAGE_SIZE; renderItems(); });
}

/* ---------- Editor de un elemento ---------- */

function openEditor(item) {
  if (!item) return;
  editingItem = item;
  $("editSymbol").textContent = item.value;
  $("editTitle").textContent = item.type === "kanji" ? "Kanji" : t("Palabra");
  $("editSub").textContent = item.studied
    ? t("Aciertos: {correct} · Fallos: {wrong} · {state}",
        { correct: item.correctCount, wrong: item.incorrectCount, state: itemState(item) })
    : t("Sin estudiar");
  $("editLevel").value = item.level;
  $("editReadings").value = displayReadings(item).join(", ");
  $("editMeanings").value = (item.dictionary?.meanings || []).join(", ");
  $("editDialog").showModal();
}

function userDictionary(item, readings, meanings) {
  return {
    v: DICT_VERSION,
    source: "user",
    readings: [...new Set(readings.map(normalizeReading).filter(Boolean))],
    display: item.type === "kanji"
      ? { on: [], kun: [], imported: readings }
      : { words: readings },
    meanings
  };
}

async function saveEditor() {
  const item = editingItem;
  const readings = splitInput($("editReadings").value);
  const meanings = $("editMeanings").value.split(/[,;\n]+/).map((m) => m.trim()).filter(Boolean);

  item.level = $("editLevel").value;

  const changed =
    readings.join("|") !== displayReadings(item).join("|") ||
    meanings.join("|") !== (item.dictionary?.meanings || []).join("|");
  if (changed) {
    if (readings.length) {
      item.dictionary = userDictionary(item, readings, meanings);
      item.lookupStatus = "found";
      delete item.lookupError;
    } else {
      item.dictionary = null;
      item.lookupStatus = "pending";
    }
  }

  item.updatedAt = Date.now();
  await saveItem(item);
  renderAll();
  scheduleSync();
  if (!hasReadings(item)) runLookups();
}

async function resetProgress() {
  const item = editingItem;
  if (!confirm(t("¿Reiniciar el progreso de {value}?", { value: item.value }))) return;
  const { dictionary, lookupStatus, createdAt, source, level } = item;
  Object.assign(item, newItem(item.type, item.value, level),
    { dictionary, lookupStatus, createdAt, source });
  delete item.skippedCount;
  await saveItem(item);
  $("editDialog").close();
  renderAll();
  scheduleSync();
}

function bindEditor() {
  $("editDialog").addEventListener("close", () => {
    if ($("editDialog").returnValue === "save" && editingItem) saveEditor();
    $("editDialog").returnValue = "";
  });
  $("editResetBtn").addEventListener("click", resetProgress);
}

/* =========================================
   7. ESTADÍSTICAS
   ========================================= */

function renderStats() {
  const studied = items.filter((i) => i.studied);
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
  renderLevels();
  renderHardest();
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

function renderLevels() {
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

function renderHardest() {
  const hardest = items
    .filter((i) => i.incorrectCount > 0)
    .sort((a, b) => b.incorrectCount - a.incorrectCount || a.correctCount - b.correctCount)
    .slice(0, 8);

  $("hardList").innerHTML = hardest.length
    ? hardest.map((item) => `
      <button class="hard-item" type="button" data-hard="${escapeHTML(item.id)}">
        <span class="hard-symbol">${escapeHTML(item.value)}</span>
        <span class="hard-reading">${escapeHTML(displayReadings(item).slice(0, 2).join(" · "))}</span>
        <span class="hard-count">${plural(item.incorrectCount, "fallo", "fallos")}</span>
      </button>`).join("")
    : `<p class="helper">${t("Aquí aparecerán los elementos que más falles.")}</p>`;
}

/* =========================================
   8. SELECCIÓN DE SESIÓN
   ========================================= */

function chooseSession() {
  const count = Number($("studyCount").value) || Infinity; // 0 = todas
  const learned = learnedKanji();
  const candidates = items.filter((i) => matchesStudyFilter(i) && isUnlocked(i, learned));

  // 1. Tarjetas cuya fecha de revisión ya llegó.
  const due = candidates.filter(isDue);
  // 2. Tarjetas que todavía no se han estudiado.
  const fresh = candidates.filter((item) => !item.studied);
  // 3. El resto, como práctica extra: primero las que vencen antes.
  //    Acertarlas no adelanta su calendario; fallarlas sí las reinicia.
  const extra = candidates
    .filter((item) => item.studied && !isDue(item))
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview));

  const cards = [
    ...shuffle(due).map((item) => ({ item, kind: "due" })),
    ...shuffle(fresh).map((item) => ({ item, kind: "new" })),
    ...extra.map((item) => ({ item, kind: "extra" }))
  ];
  return cards.slice(0, count);
}

function startSession() {
  const queue = chooseSession();

  if (!queue.length) {
    session = null;
    document.body.classList.remove("studying");
    renderStudyHome();
    return;
  }

  session = {
    queue,
    total: queue.length,
    done: 0,
    firstTry: 0,
    missed: new Map(),
    mode: $("studyMode").value
  };
  document.body.classList.add("studying");
  showCard();
  $("studyArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================================
   9. LECTURAS Y SIGNIFICADOS
   -----------------------------------------
   Jisho NO envía cabeceras CORS, así que no se puede consultar
   desde el navegador. Usamos kanjiapi.dev:
     /v1/kanji/{kanji} -> on_readings, kun_readings, meanings
     /v1/words/{kanji} -> todas las palabras que contienen ese kanji
                          [{variants:[{written, pronounced}], meanings}]
   Para una palabra se pide la lista de uno de sus kanjis y se
   busca en ella la escritura exacta.
   ========================================= */

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const wordListCache = new Map(); // kanji -> promesa con su lista de palabras

function wordsContaining(kanji) {
  if (!wordListCache.has(kanji)) {
    const request = fetchJSON("https://kanjiapi.dev/v1/words/" + encodeURIComponent(kanji));
    request.catch(() => wordListCache.delete(kanji));
    wordListCache.set(kanji, request);
  }
  return wordListCache.get(kanji);
}

async function fetchDictionary(item) {
  if (item.type === "kanji") {
    const data = await fetchJSON(
      "https://kanjiapi.dev/v1/kanji/" + encodeURIComponent(item.value)
    );

    const readings = new Set();
    for (const r of [...(data.on_readings || []), ...(data.kun_readings || [])]) {
      const full = normalizeReading(r);
      const stem = normalizeReading(r.split(".")[0]);
      if (full) readings.add(full);
      if (stem) readings.add(stem);
    }

    return {
      v: DICT_VERSION,
      source: "kanjiapi.dev",
      readings: [...readings],
      display: { on: data.on_readings || [], kun: data.kun_readings || [] },
      meanings: (data.meanings || []).slice(0, 8),
      jlpt: data.jlpt ?? null
    };
  }

  const kanji = splitKanji(item.value);

  // Palabra escrita solo con kana: su lectura es ella misma.
  if (!kanji.length) {
    return {
      v: DICT_VERSION,
      source: "kana",
      readings: [normalizeReading(item.value)],
      display: { words: [item.value] },
      meanings: []
    };
  }

  let entries = null, lastError = null;
  for (const ch of kanji) {
    try {
      entries = await wordsContaining(ch);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!entries) throw lastError;

  const readings = new Set();
  const shown = new Set();
  const meanings = new Set();

  for (const entry of entries) {
    const matches = (entry.variants || []).filter((v) => v.written === item.value);
    if (!matches.length) continue;

    for (const variant of matches) {
      const reading = normalizeReading(variant.pronounced);
      if (reading) { readings.add(reading); shown.add(variant.pronounced); }
    }
    for (const meaning of entry.meanings || []) {
      for (const gloss of meaning.glosses || []) if (gloss) meanings.add(gloss);
    }
  }

  if (!readings.size) throw new Error(t("La palabra no está en el diccionario"));

  return {
    v: DICT_VERSION,
    source: "kanjiapi.dev",
    readings: [...readings],
    display: { words: [...shown] },
    meanings: [...meanings].slice(0, 8)
  };
}

/* Convierte al formato actual un diccionario que venía en un JSON importado
   ({reading, meanings}). Devuelve true si modificó el elemento. */
function normalizeDictionary(item) {
  const imported = item.dictionary;
  if (!imported || imported.v === DICT_VERSION) return false;

  const shown = [].concat(imported.reading ?? [], imported.readings ?? [])
    .filter((r) => typeof r === "string" && r.trim());
  if (!shown.length) return false;

  item.dictionary = {
    ...imported,
    v: DICT_VERSION,
    source: "import",
    readings: [...new Set(shown.map(normalizeReading).filter(Boolean))],
    display: item.type === "kanji"
      ? { on: [], kun: [], imported: shown }
      : { words: shown },
    meanings: Array.isArray(imported.meanings) ? imported.meanings : []
  };
  item.lookupStatus = "found";
  delete item.lookupError;
  return true;
}

async function getDictionary(item) {
  if (hasReadings(item)) return item.dictionary;

  if (normalizeDictionary(item)) {
    await saveItem(item);
    return item.dictionary;
  }

  let dictionary = null, failure = null;
  try {
    dictionary = await fetchDictionary(item);
  } catch (error) {
    failure = error;
  }

  // Mientras se consultaba, el elemento pudo borrarse o editarse a mano.
  if (!items.includes(item)) return dictionary;
  if (hasReadings(item)) return item.dictionary;

  if (dictionary) {
    item.dictionary = dictionary;
    item.lookupStatus = "found";
    item.lookupDate = new Date().toISOString();
    delete item.lookupError;
  } else {
    item.lookupStatus = "error";
    item.lookupError = failure.message;
  }
  await saveItem(item);
  return item.dictionary;
}

/* Consulta en segundo plano todo lo que aún no tiene lectura */
let lookupsRunning = false;

async function runLookups(includeErrors = false) {
  if (lookupsRunning) return;
  lookupsRunning = true;

  try {
    // Se repite por si se agregan elementos mientras tanto.
    for (let round = 0; round < 20; round++) {
      const pending = items.filter((i) =>
        !hasReadings(i) && (includeErrors || i.lookupStatus !== "error"));
      if (!pending.length || !navigator.onLine) break;
      includeErrors = false;

      let done = 0;
      for (const item of pending) {
        if (!navigator.onLine) break;
        $("lookupMessage").textContent =
          t("Consultando el diccionario… {done} / {total}", { done: ++done, total: pending.length });
        if (items.includes(item)) await getDictionary(item);
        if (done % 10 === 0) renderItems();
        await sleep(80);
      }
      renderAll();
      scheduleSync();
    }
  } finally {
    lookupsRunning = false;
    $("lookupMessage").textContent = "";
  }
}

/* =========================================
   10. TARJETAS
   ========================================= */

const KIND_LABEL = { due: t("Repaso"), new: t("Nuevo"), extra: t("Práctica extra") };

function endSession() {
  const { total, firstTry, missed } = session;
  session = null;
  document.body.classList.remove("studying");

  const missedList = [...missed.values()].map((item) => `
    <li><strong>${escapeHTML(item.value)}</strong>
      <span>${escapeHTML(displayReadings(item).slice(0, 3).join(" · "))}</span></li>`).join("");

  $("studyArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>${t("Sesión terminada")}</h3>
      <p>${total
        ? t("Has repasado {n} · {percent} % a la primera.", {
            n: plural(total, "elemento", "elementos"),
            percent: Math.round((firstTry / total) * 100) })
        : t("No quedaban tarjetas por repasar.")}</p>
      ${missedList ? `<ul class="missed-list">${missedList}</ul>` : ""}
      <div class="row-actions">
        <button id="againBtn" class="button button-primary" type="button">${t("Otra sesión")}</button>
        <button class="button button-outline" data-go="progress" type="button">${t("Ver progreso")}</button>
      </div>
    </div>`;
  $("againBtn").onclick = startSession;
  $("againBtn").focus();
  syncNow();
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function answerHTML(item) {
  const dict = item.dictionary;
  const readings = item.type === "kanji" && !dict.display.imported?.length
    ? `${dict.display.kun.length
        ? `<p class="reading">Kun: ${escapeHTML(dict.display.kun.join(" · "))}</p>` : ""}
       ${dict.display.on.length
        ? `<p class="reading">On: ${escapeHTML(dict.display.on.join(" · "))}</p>` : ""}`
    : `<p class="reading">${escapeHTML(displayReadings(item).join(" · "))}</p>`;

  // Palabras de tus listas que usan este kanji
  const related = item.type === "kanji"
    ? items.filter((i) => i.type === "word" && i.value.includes(item.value)).slice(0, 4)
    : [];

  return `
    ${readings}
    ${dict.meanings?.length
      ? `<p class="meaning">${escapeHTML(dict.meanings.join(", "))}</p>` : ""}
    ${related.length ? `<p class="related">${related.map((w) => {
        const reading = displayReadings(w)[0];
        return `<span>${escapeHTML(w.value)}${reading ? `（${escapeHTML(reading)}）` : ""}</span>`;
      }).join("")}</p>` : ""}
    ${"speechSynthesis" in window
      ? `<button id="speakBtn" class="button button-quiet speak-btn" type="button">🔊 ${t("Escuchar")}</button>` : ""}`;
}

async function showCard() {
  if (!session.queue.length) return endSession();

  const active = session;
  const card = session.queue[0];
  const item = card.item;
  const area = $("studyArea");

  if (!hasReadings(item)) {
    area.innerHTML = `<p class="message">${t("Cargando…")}</p>`;
    await getDictionary(item);
    if (session !== active || session.queue[0] !== card) return;
  }

  const header = `
    <div class="card-top">
      <span class="pill">${card.failed ? t("Otra vez") : KIND_LABEL[card.kind]}</span>
      <span class="card-progress">${session.done + 1} / ${session.total}</span>
    </div>
    <div class="meter" aria-hidden="true">
      <div style="width:${(session.done / session.total) * 100}%"></div>
    </div>`;

  if (!hasReadings(item)) {
    area.innerHTML = `
      <div class="card">
        ${header}
        <div class="card-symbol">${escapeHTML(item.value)}</div>
        <p class="message incorrect">${t("No se pudo obtener la lectura ({error}).",
          { error: escapeHTML(item.lookupError || t("sin datos")) })}</p>
        <div class="row-actions">
          <button id="retryBtn" class="button button-outline" type="button">${t("Reintentar")}</button>
          <button id="skipBtn" class="button button-secondary" type="button">${t("Saltar")}</button>
        </div>
      </div>`;
    $("retryBtn").onclick = () => { item.lookupStatus = "pending"; showCard(); };
    $("skipBtn").onclick = () => {
      session.queue.shift();
      session.total--;
      showCard();
    };
    return;
  }

  const typing = session.mode === "type";
  const accepted = acceptedReadings(item);
  const kunOnly = accepted !== item.dictionary.readings;
  area.innerHTML = `
    <div class="card">
      ${header}
      <div class="card-symbol ${item.type === "word" ? "word" : ""}" lang="ja">${escapeHTML(item.value)}</div>
      ${typing ? `
      <form id="readingForm" autocomplete="off">
        <input id="readingInput" class="reading-input" type="text"
          lang="ja" inputmode="text"
          placeholder="${kunOnly ? t("Escribe una lectura kun (hiragana)") : t("Escribe la lectura (hiragana o katakana)")}"
          autocapitalize="off" autocomplete="off" spellcheck="false">
        <button id="checkBtn" class="button button-primary" type="submit">${t("Comprobar")}</button>
        <button id="unknownBtn" class="button button-secondary" type="button">${t("No lo sé")}</button>
      </form>` : `
      <div id="readingForm">
        <button id="revealBtn" class="button button-primary" type="button">${t("Mostrar respuesta")}</button>
      </div>`}
      <p id="feedback" class="message"></p>
      <div id="answer"></div>
    </div>`;

  const feedback = $("feedback");
  const answer = $("answer");
  let answered = false;

  /* Muestra la respuesta y los botones para continuar.
     ratings: lista de [valoración, etiqueta, clase] */
  function reveal(ratings, preferred) {
    answer.innerHTML = `
      ${answerHTML(item)}
      <div class="card-actions">
        ${ratings.map(([rating, label, cls], i) => {
          const days = rating === "next" ? null : schedule(item, rating, card).interval;
          return `
          <button class="button ${cls}" type="button" data-rate="${rating}">
            ${label}
            <small>${i + 1}${days === null || card.kind === "extra" && rating !== "again"
              ? "" : ` · ${days ? `${days} d` : t("hoy")}`}</small>
          </button>`;
        }).join("")}
      </div>`;

    if ($("speakBtn")) $("speakBtn").onclick = () => speak(item.value);

    answer.querySelectorAll("[data-rate]").forEach((button) => {
      button.onclick = async () => {
        answer.querySelectorAll("[data-rate]").forEach((b) => { b.disabled = true; });
        if (button.dataset.rate !== "next") await grade(card, button.dataset.rate);
        advance(card);
      };
    });
    answer.querySelector(`[data-rate="${preferred}"]`).focus(); // Enter otra vez = siguiente
  }

  const NEXT = [["next", t("Siguiente"), "button-primary"]];
  const PASSED = [
    ["hard", t("Difícil"), "button-hard"],
    ["good", t("Bien"), "button-good"],
    ["easy", t("Fácil"), "button-easy"]
  ];

  if (!typing) {
    $("revealBtn").onclick = () => {
      $("revealBtn").remove();
      reveal([["again", t("Otra vez"), "button-wrong"], ...PASSED], "good");
    };
    $("revealBtn").focus();
    return;
  }

  const input = $("readingInput");

  // Si WanaKana está cargado, "ka" se convierte en "か" al escribir
  if (window.wanakana && typeof window.wanakana.bind === "function") {
    window.wanakana.bind(input);
  }
  input.focus();

  async function finish(correct, message) {
    answered = true;
    input.disabled = true;
    $("checkBtn").disabled = true;
    $("unknownBtn").disabled = true;
    feedback.textContent = message;
    feedback.className = `message ${correct ? "correct" : "incorrect"}`;

    if (correct) return reveal(PASSED, "good");
    // El fallo se registra de inmediato, aunque no se pulse "Siguiente"
    await grade(card, "again");
    reveal(NEXT, "next");
  }

  $("unknownBtn").onclick = () => {
    if (!answered) finish(false, t("Esta es la respuesta:"));
  };

  $("readingForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (answered) return;

    const userAnswer = normalizeReading(input.value);
    if (!userAnswer) {
      feedback.textContent = t("Escribe una lectura primero.");
      return;
    }
    const correct = accepted.includes(userAnswer);
    // Una lectura on no cuenta como fallo: se pide la kun
    if (!correct && kunOnly && item.dictionary.readings.includes(userAnswer)) {
      feedback.textContent = t("Esa es una lectura on. Escribe una lectura kun.");
      feedback.className = "message";
      input.select();
      return;
    }
    finish(correct, correct ? t("¡Correcto!") : t("No es correcto."));
  });
}

/* Pasa a la siguiente tarjeta; las falladas vuelven a salir un poco después */
function advance(card) {
  const index = session.queue.indexOf(card);
  if (index >= 0) session.queue.splice(index, 1);

  if (card.pendingRetry) {
    card.pendingRetry = false;
    session.queue.splice(Math.min(3, session.queue.length), 0, card);
  } else {
    session.done++;
    if (!card.failed) session.firstTry++;
  }
  showCard();
}

/* Atajos: 1-4 eligen la valoración cuando la respuesta está a la vista */
function bindShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (!session || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.matches?.("input:not(:disabled), textarea, select")) return;
    const buttons = $("answer")?.querySelectorAll("[data-rate]:not(:disabled)");
    const button = buttons?.[Number(event.key) - 1];
    if (button) {
      event.preventDefault();
      button.click();
    }
  });
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
let draw = null;

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

function drawCandidates() {
  const level = $("drawLevel").value;
  return items.filter((i) => isLearned(i) && (level === "ALL" || i.level === level));
}

function renderDraw() {
  const candidates = drawCandidates();
  $("drawCount").textContent = plural(items.filter(isLearned).length, "aprendido", "aprendidos");

  if (!candidates.length) {
    draw = null;
    $("drawArea").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">書</div>
        <h3>${$("drawLevel").value === "ALL"
          ? t("Aún no hay kanjis aprendidos") : t("Aún no hay kanjis aprendidos en este nivel")}</h3>
        <p>${t("Cuando aciertes un kanji en un repaso podrás practicar aquí su escritura.")}</p>
      </div>`;
    return;
  }
  // Se conserva el kanji a medias si sigue siendo válido
  if (!draw || !candidates.includes(draw.item)) nextDraw();
}

async function nextDraw() {
  const candidates = drawCandidates();
  if (!candidates.length) return renderDraw();

  let queue = (draw?.queue || []).filter((i) => candidates.includes(i));
  if (!queue.length) {
    queue = shuffle(candidates);
    if (queue.length > 1 && queue[0] === draw?.item) queue.push(queue.shift());
  }
  const item = queue.shift();
  const current = draw = { item, queue };
  const area = $("drawArea");
  area.innerHTML = `<p class="message">${t("Cargando…")}</p>`;

  let strokes;
  try {
    [strokes] = await Promise.all([fetchStrokes(item.value), getDictionary(item)]);
  } catch (error) {
    if (draw !== current) return;
    area.innerHTML = `
      <div class="card">
        <p class="message incorrect">${t("No se pudieron cargar los trazos ({error}).",
          { error: escapeHTML(error.message) })}</p>
        <div class="row-actions">
          <button id="drawNextBtn" class="button button-outline" type="button">${t("Otro kanji")}</button>
        </div>
      </div>`;
    $("drawNextBtn").onclick = nextDraw;
    return;
  }
  if (draw !== current) return;

  const dict = item.dictionary;
  const half = KVG_SIZE / 2;
  area.innerHTML = `
    <div class="card draw-card">
      <div class="card-top">
        <span class="pill">${escapeHTML(item.level)}</span>
        <span id="drawProgress" class="card-progress"></span>
      </div>
      ${dict?.meanings?.length
        ? `<p class="meaning">${escapeHTML(dict.meanings.join(", "))}</p>` : ""}
      <p class="reading" lang="ja">${escapeHTML(displayReadings(item).join(" · "))}</p>
      <svg id="drawPad" class="draw-pad" viewBox="0 0 ${KVG_SIZE} ${KVG_SIZE}"
        role="img" aria-label="${t("Zona de dibujo")}">
        <line class="guide" x1="${half}" y1="0" x2="${half}" y2="${KVG_SIZE}"/>
        <line class="guide" x1="0" y1="${half}" x2="${KVG_SIZE}" y2="${half}"/>
        ${strokes.map((d) => `<path class="stroke" d="${escapeHTML(d)}"/>`).join("")}
        <polyline id="drawInk" class="ink" points=""/>
      </svg>
      <p id="drawFeedback" class="message"></p>
      <div class="row-actions">
        <button id="drawHintBtn" class="button button-outline" type="button">${t("Pista")}</button>
        <button id="drawShowBtn" class="button button-outline" type="button">${t("Mostrar")}</button>
        <button id="drawClearBtn" class="button button-quiet" type="button">${t("Reiniciar")}</button>
        <button id="drawNextBtn" class="button button-primary" type="button">${t("Siguiente")} →</button>
      </div>
    </div>`;

  const pad = $("drawPad");
  const ink = $("drawInk");
  const feedback = $("drawFeedback");
  const paths = [...pad.querySelectorAll(".stroke")];
  let index = 0, misses = 0, mistakes = 0, points = null;

  const say = (text, cls = "") => {
    feedback.textContent = text;
    feedback.className = `message ${cls}`;
  };
  const progress = () => {
    $("drawProgress").textContent = index < paths.length
      ? t("Trazo {i} / {n}", { i: index + 1, n: paths.length }) : plural(paths.length, "trazo", "trazos");
    $("drawHintBtn").disabled = $("drawShowBtn").disabled = index >= paths.length;
  };
  const reset = () => {
    paths.forEach((path) => { path.className.baseVal = "stroke"; });
    index = misses = mistakes = 0;
    say("");
    progress();
  };

  function check(drawn) {
    const result = matchStroke(drawn, paths[index]);
    if (result !== "ok") {
      misses++;
      mistakes++;
      say(result === "reversed"
        ? t("El trazo va en la dirección contraria.") : t("Ese no es el trazo que toca."), "incorrect");
      if (misses >= 3) paths[index].classList.add("hint");
      return;
    }
    paths[index].className.baseVal = "stroke done";
    index++;
    misses = 0;
    progress();
    if (index < paths.length) return say("");
    say(mistakes ? t("Completado con {n}.", { n: plural(mistakes, "fallo", "fallos") }) : t("¡Perfecto!"),
      mistakes ? "" : "correct");
    $("drawNextBtn").focus();
  }

  const position = (event) => {
    const rect = pad.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * KVG_SIZE,
      ((event.clientY - rect.top) / rect.height) * KVG_SIZE
    ];
  };
  const trace = () => ink.setAttribute("points",
    points ? points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") : "");

  pad.onpointerdown = (event) => {
    if (index >= paths.length) return;
    event.preventDefault();
    try { pad.setPointerCapture(event.pointerId); } catch { /* puntero ya liberado */ }
    points = [position(event)];
    trace();
  };
  pad.onpointermove = (event) => {
    if (!points) return;
    points.push(position(event));
    trace();
  };
  pad.onpointerup = pad.onpointercancel = () => {
    if (!points) return;
    const drawn = points;
    points = null;
    trace();
    check(drawn);
  };

  $("drawHintBtn").onclick = () => paths[index]?.classList.add("hint");
  $("drawShowBtn").onclick = () => {
    paths.slice(index).forEach((path) => { path.className.baseVal = "stroke done shown"; });
    index = paths.length;
    progress();
    say(t("Así se escribe. Pulsa “Reiniciar” para intentarlo."));
  };
  $("drawClearBtn").onclick = reset;
  $("drawNextBtn").onclick = nextDraw;
  reset();
}

/* =========================================
   11. REPETICIÓN ESPACIADA (variante de SM-2)
   ========================================= */

/* Calcula, sin modificar nada, cómo quedaría el elemento tras una respuesta */
function schedule(item, rating, card = {}) {
  const ease = item.ease || 2.5;
  const prev = item.interval || 0;
  const reps = item.repetitions || 0;

  if (rating === "again") {
    return { interval: 0, repetitions: 0, ease: Math.max(1.3, ease - 0.2) };
  }
  // Acertada tras fallarla en esta misma sesión: vuelve mañana.
  if (card.failed) return { interval: 1, repetitions: 1, ease };
  // Práctica extra (aún no tocaba): no cambia el calendario.
  if (card.kind === "extra") return { interval: prev, repetitions: reps, ease, keepDate: true };

  if (rating === "hard") {
    return {
      interval: Math.max(1, Math.round(prev * 1.2)),
      repetitions: reps + 1,
      ease: Math.max(1.3, ease - 0.15)
    };
  }
  if (rating === "easy") {
    return {
      interval: reps === 0 ? 4 : Math.max(prev + 2, Math.round(prev * ease * 1.3)),
      repetitions: reps + 1,
      ease: ease + 0.15
    };
  }
  return {
    interval: reps === 0 ? 1 : Math.max(prev + 1, reps === 1 ? 3 : Math.round(prev * ease)),
    repetitions: reps + 1,
    ease
  };
}

async function grade(card, rating) {
  const item = card.item;
  const correct = rating !== "again";
  const next = schedule(item, rating, card);

  // Historial diario: solo cuenta el primer intento de cada tarjeta
  if (!card.failed) {
    const day = meta.days[today()] ??= { r: 0, c: 0, n: 0 };
    day.r++;
    if (correct) day.c++;
    if (!item.studied) day.n++;
  }

  if (correct) {
    item.correctCount++;
  } else {
    item.incorrectCount++;
    card.failed = true;
    card.pendingRetry = true;
    session?.missed.set(item.id, item);
  }

  item.repetitions = next.repetitions;
  item.interval = next.interval;
  item.ease = next.ease;
  if (!next.keepDate) item.nextReview = daysFromNow(next.interval);
  item.status = item.interval >= 21 ? "mature" : "learning";
  item.studied = true;
  item.lastReviewed = new Date().toISOString();
  item.updatedAt = Date.now();

  await saveItem(item);
  await saveMeta();

  updateCounts();
  scheduleSync();
}

/* =========================================
   12. COMBINAR DATOS (importación y sincronización)
   ========================================= */

const stamp = (item) =>
  item.updatedAt || Date.parse(item.lastReviewed || item.createdAt || "") || 0;

/* JSON con las claves ordenadas, para comparar objetos */
const stable = (object) => JSON.stringify(
  Object.keys(object).sort().map((key) => [key, object[key]]));

function buildPayload() {
  return {
    app: "kanji-learning-app",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items,
    deleted: meta.deleted,
    days: meta.days
  };
}

/* Solo se copian campos conocidos */
function sanitizeRecord(raw) {
  const base = newItem(raw.type, normalizeText(raw.value), LEVELS.includes(raw.level) ? raw.level : "N3");

  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  const text = (v, d) => typeof v === "string" && v ? v : d;

  const record = {
    ...base,
    createdAt: text(raw.createdAt, base.createdAt),
    source: text(raw.source, "import"),
    dictionary: raw.dictionary && typeof raw.dictionary === "object"
      ? raw.dictionary
      : null,
    lookupStatus: raw.dictionary ? text(raw.lookupStatus, "found") : "pending",
    studied: !!raw.studied,
    correctCount: num(raw.correctCount, 0),
    incorrectCount: num(raw.incorrectCount, 0),
    repetitions: num(raw.repetitions, 0),
    interval: num(raw.interval, 0),
    ease: num(raw.ease, 2.5),
    lastReviewed: text(raw.lastReviewed, null),
    nextReview: /^\d{4}-\d{2}-\d{2}$/.test(raw.nextReview)
      ? raw.nextReview
      : today(),
    status: ["new", "learning", "mature"].includes(raw.status)
      ? raw.status
      : base.status
  };
  // Las copias antiguas no traen `updatedAt`: se deduce de sus fechas
  record.updatedAt = num(raw.updatedAt, 0) ||
    Date.parse(raw.lastReviewed || raw.createdAt || "") || 0;
  if (raw.lookupDate) record.lookupDate = text(raw.lookupDate, null);
  if (raw.lookupError) record.lookupError = text(raw.lookupError, "");
  if (raw.skippedCount) record.skippedCount = num(raw.skippedCount, 0);

  // Un JSON hecho a mano puede traer la lectura fuera de `dictionary`
  if (!record.dictionary && raw.reading) {
    record.dictionary = {
      reading: raw.reading,
      meanings: [].concat(raw.meaning ?? raw.meanings ?? []).filter((m) => typeof m === "string")
    };
  }
  normalizeDictionary(record);
  return record;
}

/* Combina los datos locales con otros (un archivo o la copia remota).
   En cada elemento gana la versión modificada más recientemente; los borrados
   se recuerdan para que no reaparezcan. Devuelve qué lado ha cambiado. */
async function mergeData(incoming) {
  const result = { added: 0, updated: 0, removed: 0, localChanged: false, remoteChanged: false };

  const incomingDeleted = incoming.deleted && typeof incoming.deleted === "object" ? incoming.deleted : {};
  const incomingDays = incoming.days && typeof incoming.days === "object" ? incoming.days : {};

  const deleted = { ...meta.deleted };
  for (const [id, when] of Object.entries(incomingDeleted)) {
    if (Number(when) > (deleted[id] || 0)) deleted[id] = Number(when);
  }

  const local = new Map(items.map((i) => [i.id, i]));
  const remote = new Map();
  for (const raw of Array.isArray(incoming.items) ? incoming.items : []) {
    if (!raw || !["kanji", "word"].includes(raw.type) ||
        typeof raw.value !== "string" || !raw.value.trim()) continue;
    const clean = sanitizeRecord(raw);
    remote.set(clean.id, clean);
  }

  const merged = [], toSave = [], toDelete = [];

  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const mine = local.get(id);
    const theirs = remote.get(id);
    const winner = !mine ? theirs : !theirs ? mine : stamp(theirs) > stamp(mine) ? theirs : mine;
    const loser = winner === mine ? theirs : mine;

    if (deleted[id] && deleted[id] >= stamp(winner)) {
      if (mine) { toDelete.push(id); result.removed++; result.localChanged = true; }
      if (theirs) result.remoteChanged = true;
      continue;
    }
    delete deleted[id]; // se volvió a agregar después de borrarlo

    // La lectura ya consultada no se pierde aunque gane la otra versión.
    let record = winner;
    if (loser && !hasReadings(winner) && hasReadings(loser)) {
      record = {
        ...winner,
        dictionary: loser.dictionary,
        lookupStatus: loser.lookupStatus,
        lookupDate: loser.lookupDate
      };
      delete record.lookupError;
    }

    if (record !== mine) {
      toSave.push(record);
      result.localChanged = true;
      if (mine) result.updated++; else result.added++;
    }
    if (!theirs || record !== theirs &&
        (stamp(record) !== stamp(theirs) || hasReadings(record) !== hasReadings(theirs))) {
      result.remoteChanged = true;
    }
    merged.push(record);
  }

  // Historial diario: el máximo de cada contador (no duplica al repetir la combinación)
  const days = { ...meta.days };
  for (const [date, theirs] of Object.entries(incomingDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !theirs) continue;
    const mine = days[date] || {};
    days[date] = {
      r: Math.max(mine.r || 0, Number(theirs.r) || 0),
      c: Math.max(mine.c || 0, Number(theirs.c) || 0),
      n: Math.max(mine.n || 0, Number(theirs.n) || 0)
    };
  }

  const daysText = stable(days), deletedText = stable(deleted);
  if (daysText !== stable(incomingDays) || deletedText !== stable(incomingDeleted)) {
    result.remoteChanged = true;
  }
  const metaChanged = daysText !== stable(meta.days) || deletedText !== stable(meta.deleted);

  meta.days = days;
  meta.deleted = deleted;

  if (toSave.length || toDelete.length) await writeItems(toSave, toDelete);
  if (metaChanged) await saveMeta();
  if (result.localChanged || metaChanged) {
    adoptItems(merged);
    renderAll();
  }
  return result;
}

/* =========================================
   13. EXPORTAR E IMPORTAR
   ========================================= */

function exportData() {
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kanji-learning-backup-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revocar de inmediato puede cancelar la descarga
}

function parsePayload(text) {
  const parsed = JSON.parse(text);
  if (parsed?.app !== "kanji-learning-app" ||
      ![1, 2].includes(parsed.schemaVersion) ||
      !Array.isArray(parsed.items)) {
    throw new Error(t("El archivo no tiene un formato compatible."));
  }
  return parsed;
}

async function importData() {
  if (!pendingImport) return;

  try {
    const result = await mergeData(parsePayload(await pendingImport.text()));

    $("importMessage").textContent =
      t("Importación completada. Nuevos: {added}; actualizados: {updated}.", result);
    pendingImport = null;
    $("mergeBtn").disabled = true;
    $("importFile").value = "";
    scheduleSync();
    runLookups();
  } catch (error) {
    $("importMessage").textContent = error.message || t("No se pudo importar el archivo.");
  }
}

/* =========================================
   14. SINCRONIZACIÓN (gist privado de GitHub)
   -----------------------------------------
   No hay servidor propio: los datos se guardan como un archivo JSON
   en un gist privado del usuario. En cada sincronización se descarga
   la copia remota, se combina con la local (mergeData) y, si la remota
   quedó desactualizada, se vuelve a subir.
   ========================================= */

const sync = {
  config: loadLocal("kanji-sync", { token: "", gistId: "", lastSync: 0 }),
  running: false,
  queued: false,
  timer: null
};

function setSyncState(state, message = "") {
  const labels = {
    off: t("Solo en este dispositivo"),
    syncing: t("Sincronizando…"),
    ok: t("Sincronizado"),
    offline: t("Sin conexión"),
    error: t("Error al sincronizar")
  };
  $("syncBtn").dataset.state = state;
  $("syncLabel").textContent = labels[state];
  $("syncBtn").title = message || labels[state];
  $("syncMessage").textContent = message;
  $("syncMessage").classList.toggle("incorrect", state === "error");
  $("footerNote").textContent = state === "off"
    ? t("Datos guardados localmente en este navegador")
    : t("Datos guardados en este navegador y en tu gist privado");
}

async function github(path, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${sync.config.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 401 ? t("GitHub rechazó el token. Comprueba que sea válido.")
      : response.status === 403 ? t("El token no tiene el permiso “gist” o se alcanzó el límite de GitHub.")
      : t("GitHub respondió {status}.", { status: response.status }));
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const gistBody = () => JSON.stringify({
  description: "Kanji Learning App · datos sincronizados",
  files: { [GIST_FILE]: { content: JSON.stringify(buildPayload()) } }
});

/* Busca el gist de la app en la cuenta (otro dispositivo pudo crearlo) o lo crea */
async function findOrCreateGist() {
  for (let page = 1; page <= 5; page++) {
    const gists = await github(`/gists?per_page=100&page=${page}`);
    const found = gists.find((g) => g.files && g.files[GIST_FILE]);
    if (found) return found.id;
    if (gists.length < 100) break;
  }
  const body = JSON.parse(gistBody());
  const created = await github("/gists", {
    method: "POST",
    body: JSON.stringify({ ...body, public: false })
  });
  return created.id;
}

async function syncNow() {
  clearTimeout(sync.timer);
  sync.timer = null;
  if (!sync.config.token) return;
  if (sync.running) { sync.queued = true; return; }
  if (!navigator.onLine) return setSyncState("offline");

  sync.running = true;
  setSyncState("syncing");

  try {
    if (!sync.config.gistId) {
      sync.config.gistId = await findOrCreateGist();
      saveLocal("kanji-sync", sync.config);
    }

    let gist;
    try {
      gist = await github(`/gists/${sync.config.gistId}`);
    } catch (error) {
      if (error.status === 404) { // el gist se borró: se creará otro en el siguiente intento
        sync.config.gistId = "";
        saveLocal("kanji-sync", sync.config);
        throw new Error(t("No se encontró el gist. Vuelve a sincronizar para crearlo de nuevo."));
      }
      throw error;
    }

    const file = gist.files?.[GIST_FILE];
    let remote = { items: [] };
    if (file) {
      // GitHub recorta el contenido de los archivos de más de 1 MB
      const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
      remote = parsePayload(text);
    }

    const result = await mergeData(remote);
    if (result.remoteChanged || !file) {
      await github(`/gists/${sync.config.gistId}`, { method: "PATCH", body: gistBody() });
    }

    sync.config.lastSync = Date.now();
    saveLocal("kanji-sync", sync.config);
    setSyncState("ok", t("Última sincronización: {time}.", {
      time: new Date().toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) }));
    if (result.added) runLookups();
  } catch (error) {
    console.error("Error de sincronización:", error);
    if (navigator.onLine && !(error instanceof TypeError)) {
      setSyncState("error", error.message);
    } else {
      setSyncState("offline");
    }
  } finally {
    sync.running = false;
    renderDataView();
    if (sync.queued) {
      sync.queued = false;
      scheduleSync();
    }
  }
}

/* Agrupa los cambios seguidos en una sola subida */
function scheduleSync(delay = 4000) {
  if (!sync.config.token) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, delay);
}

async function connectSync() {
  const token = $("syncToken").value.trim();
  if (!token) {
    $("syncMessage").textContent = t("Pega primero el token.");
    return;
  }
  sync.config = { token, gistId: "", lastSync: 0 };
  saveLocal("kanji-sync", sync.config);
  $("syncToken").value = "";
  await syncNow();

  // Token rechazado: no se conserva
  if ($("syncBtn").dataset.state === "error" && !sync.config.gistId) {
    const message = $("syncMessage").textContent;
    sync.config = { token: "", gistId: "", lastSync: 0 };
    saveLocal("kanji-sync", sync.config);
    setSyncState("off", message);
    $("syncMessage").classList.add("incorrect");
    renderDataView();
  }
}

function disconnectSync() {
  if (!confirm(t("¿Dejar de sincronizar en este dispositivo? Los datos locales y el gist se conservan."))) return;
  clearTimeout(sync.timer);
  sync.config = { token: "", gistId: "", lastSync: 0 };
  saveLocal("kanji-sync", sync.config);
  setSyncState("off");
  renderDataView();
}

function renderDataView() {
  const connected = !!sync.config.token;
  $("syncSetup").classList.toggle("hidden", connected);
  $("syncActive").classList.toggle("hidden", !connected);
  $("syncGistLink").classList.toggle("hidden", !sync.config.gistId);
  if (sync.config.gistId) {
    $("syncGistLink").href = `https://gist.github.com/${sync.config.gistId}`;
  }
  $("syncNowBtn").disabled = sync.running;

  const missing = items.filter((i) => !hasReadings(i)).length;
  $("dictSummary").textContent = missing
    ? t("{n} sin lectura. Puedes reintentar la consulta o escribirla a mano desde “Mis listas”.",
        { n: plural(missing, "elemento", "elementos") })
    : t("Todos los elementos tienen lectura.");
  $("retryLookupsBtn").disabled = !missing;
}

function bindSync() {
  $("syncConnectBtn").addEventListener("click", connectSync);
  $("syncNowBtn").addEventListener("click", syncNow);
  $("syncDisconnectBtn").addEventListener("click", disconnectSync);
  $("syncBtn").addEventListener("click", () =>
    sync.config.token ? syncNow() : switchView("data"));

  window.addEventListener("online", syncNow);
  window.addEventListener("offline", () => sync.config.token && setSyncState("offline"));

  // Al volver a la app se recogen los cambios hechos en otros dispositivos;
  // al salir se suben los que estuvieran pendientes.
  document.addEventListener("visibilitychange", () => {
    if (!sync.config.token) return;
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
      if (!session) renderStudyHome();
    });
  }

  $("goalInput").value = prefs.goal;
  $("goalInput").addEventListener("change", () => {
    prefs.goal = Math.min(500, Math.max(1, Math.round(Number($("goalInput").value)) || 20));
    $("goalInput").value = prefs.goal;
    saveLocal("kanji-prefs", prefs);
    updateCounts();
  });

  $("importType").addEventListener("change", () => {
    const kanji = $("importType").value === "kanji";
    $("listLabel").textContent = kanji ? t("Lista de kanjis") : t("Lista de palabras");
    $("listInput").placeholder = kanji ? "政, 議, 民, 経, 済" : "政治, 政府, 行政";
  });

  $("drawLevel").addEventListener("change", () => { draw = null; renderDraw(); });
  $("addBtn").addEventListener("click", addList);
  $("baseLists").addEventListener("click", (event) => {
    const button = event.target.closest("[data-base]");
    if (button && !button.disabled) addBaseList(...button.dataset.base.split(":"));
  });
  $("startBtn").addEventListener("click", startSession);
  $("exportBtn").addEventListener("click", exportData);
  $("retryLookupsBtn").addEventListener("click", () => {
    switchView("manage");
    runLookups(true);
  });

  $("importFile").addEventListener("change", (event) => {
    pendingImport = event.target.files?.[0] || null;
    $("mergeBtn").disabled = !pendingImport;
    $("importMessage").textContent = pendingImport
      ? t("Archivo seleccionado: {name}", { name: pendingImport.name }) : "";
  });
  $("mergeBtn").addEventListener("click", importData);

  $("hardList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-hard]");
    if (button) openEditor(items.find((i) => i.id === button.dataset.hard));
  });
}

/* =========================================
   16. INICIO
   ========================================= */

async function init() {
  try {
    db = await openDatabase();
    await loadMeta();
    items = await getAll("items");

    // Diccionarios que venían en un JSON importado con el formato antiguo
    const migrated = items.filter(normalizeDictionary);
    if (migrated.length) await saveItems(migrated);
  } catch (error) {
    console.error("Error al iniciar la aplicación:", error);
    $("studyArea").innerHTML = `
      <div class="empty-state">
        <h3>${t("No se pudo abrir el almacenamiento local")}</h3>
        <p>${t("Abre la aplicación desde un navegador compatible con IndexedDB.")}</p>
      </div>`;
    return;
  }

  bindNavigation();
  bindList();
  bindEditor();
  bindShortcuts();
  bindSettings();
  bindSync();

  setSyncState(sync.config.token ? "ok" : "off");
  renderAll();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  await syncNow();
  runLookups(true);
}

init();
