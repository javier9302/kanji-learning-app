/* =========================================
   KANJI LEARNING APP - app.js (revisado)
   ========================================= */

const DB_NAME = "kanji-learning-app";
const DB_VERSION = 1;
const DICT_VERSION = 2; // sube este número para forzar nuevas consultas

let db;
let items = [];
let session = [];
let sessionIndex = 0;
let pendingImport = null;

const $ = (id) => document.getElementById(id);

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
   1. INDEXEDDB
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function allItems() {
  return new Promise((resolve, reject) => {
    const request = db.transaction("items", "readonly").objectStore("items").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/* Guarda uno o varios elementos en UNA sola transacción */
function saveItems(list) {
  const batch = Array.isArray(list) ? list : [list];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    batch.forEach((item) => store.put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const saveItem = saveItems;

function deleteItem(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================
   2. AUXILIARES
   ========================================= */

const normalizeText = (v) => String(v ?? "").trim().normalize("NFKC");
const isKanji = (c) => /\p{Script=Han}/u.test(c);
const splitKanji = (word) => [...new Set([...word].filter(isKanji))];

function splitInput(value) {
  return [...new Set(value.split(/[,，;；\n\r]+/).map(normalizeText).filter(Boolean))];
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
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[.\-\s・]/g, "");
}

/* =========================================
   3. NAVEGACIÓN (delegación: sin listeners duplicados)
   ========================================= */

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("hidden", v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name));
  if (name === "manage") renderItems();
  if (name === "progress") renderStats();
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

async function refresh() {
  items = await allItems();
  updateCounts();
  renderItems();
  renderStats();
}

function updateCounts() {
  const due = items.filter((i) => i.studied && i.nextReview <= today());
  $("itemCount").textContent = `${items.length} elementos`;
  $("dueBadge").textContent = `${due.length} pendientes`;
}

/* =========================================
   5. AGREGAR ELEMENTOS
   ========================================= */

function newItem(type, value, level) {
  return {
    id: uid(type, value),
    type, value, level,
    createdAt: new Date().toISOString(),
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
    $("addMessage").textContent = "Introduce al menos un elemento.";
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

    // Las palabras también crean sus kanjis (antes ensureRelatedKanji nunca se llamaba)
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

  if (toSave.length) await saveItems(toSave);

  $("listInput").value = "";
  $("addMessage").textContent =
    `Agregados: ${toSave.length - derived}` +
    (derived ? ` (+${derived} kanjis derivados)` : "") +
    `. Ya existentes: ${skipped}.` +
    (invalid ? ` Formato no válido: ${invalid}.` : "");

  await refresh();
}

/* =========================================
   6. LISTA DE ELEMENTOS
   ========================================= */

function renderItems() {
  const list = $("itemsList");

  if (!items.length) {
    list.innerHTML = `<div class="no-items">Todavía no has agregado kanjis ni palabras.</div>`;
    return;
  }

  const filter = normalizeText($("filterInput").value).toLowerCase();
  const filtered = items
    .filter((i) => `${i.value} ${i.level} ${i.type}`.toLowerCase().includes(filter))
    .sort((a, b) => a.value.localeCompare(b.value));

  if (!filtered.length) {
    list.innerHTML = `<div class="no-items">No se encontraron elementos.</div>`;
    return;
  }

  list.innerHTML = filtered.map((item) => {
    const reading = item.dictionary?.readings?.[0];
    const info = reading
      ? escapeHTML(reading)
      : item.lookupStatus === "error" ? "No se pudo consultar" : "Información pendiente";
    return `
    <article class="item-row">
      <div class="item-symbol">${escapeHTML(item.value)}</div>
      <div class="item-info">
        <div class="item-title">${escapeHTML(item.value)}</div>
        <div class="item-sub">
          ${item.type === "kanji" ? "Kanji" : "Palabra"} · ${escapeHTML(item.level)} · ${info}
        </div>
      </div>
      <div class="item-state">${item.studied ? `Repasos: ${item.repetitions}` : "Sin estudiar"}</div>
      <button class="delete-btn" data-delete="${escapeHTML(item.id)}"
        title="Eliminar" aria-label="Eliminar ${escapeHTML(item.value)}">×</button>
    </article>`;
  }).join("");
}

/* Un único listener para todos los botones de borrar */
function bindDelete() {
  $("itemsList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    const id = button.dataset.delete;
    const value = id.split(":").slice(1).join(":");
    if (confirm(`¿Eliminar ${value} y su progreso?`)) {
      await deleteItem(id);
      await refresh();
    }
  });
}

/* =========================================
   7. ESTADÍSTICAS
   ========================================= */

function renderStats() {
  const studied = items.filter((i) => i.studied);
  $("statTotal").textContent = items.length;
  $("statStudied").textContent = studied.length;
  $("statDue").textContent = studied.filter((i) => i.nextReview <= today()).length;
  $("statMature").textContent = items.filter((i) => i.status === "mature").length;
}

/* =========================================
   8. SELECCIÓN DE SESIÓN
   ========================================= */

function chooseSession() {
  const type = $("studyType").value;
  const level = $("studyLevel").value;
  const count = Number($("studyCount").value);

  const candidates = items.filter((item) =>
    (type === "mixed" || item.type === type) &&
    (level === "ALL" || item.level === level)
  );

  // 1. Tarjetas cuya fecha de revisión ya llegó.
  const due = candidates.filter((item) =>
    item.studied && item.nextReview && item.nextReview <= today()
  );

  // 2. Tarjetas que todavía no se han estudiado.
  const newCards = candidates.filter((item) => !item.studied);

  // 3. Todas las tarjetas, para reiniciar el ciclo
  // cuando ya no queden pendientes ni tarjetas nuevas.
  const allCards = shuffle(candidates);

  const selected = [];
  const selectedIds = new Set();

  function addCards(cards) {
    for (const item of shuffle(cards)) {
      if (selected.length >= count) break;

      if (!selectedIds.has(item.id)) {
        selected.push(item);
        selectedIds.add(item.id);
      }
    }
  }

  // Prioridad: pendientes, nuevas y finalmente todas.
  addCards(due);
  addCards(newCards);
  addCards(allCards);

  return selected;
}

async function startSession() {
  session = chooseSession();
  sessionIndex = 0;

  if (!session.length) {
  const hasMatchingItems = items.some((item) =>
    ($("studyType").value === "mixed" ||
      item.type === $("studyType").value) &&
    ($("studyLevel").value === "ALL" ||
      item.level === $("studyLevel").value)
  );

  $("studyArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>${
        hasMatchingItems
          ? "¡Has terminado el repaso por ahora!"
          : "No hay elementos en esta selección"
      }</h3>
      <p>${
        hasMatchingItems
          ? "No tienes tarjetas pendientes para revisar con estos filtros. Las próximas revisiones estarán disponibles según su calendario."
          : "No hay elementos de este tipo y nivel en tus listas."
      }</p>
      <button class="button button-outline" data-go="progress" type="button">
        Ver progreso
      </button>
    </div>`;
  return;
}
  await showCard();
}

/* =========================================
   9. LECTURAS Y SIGNIFICADOS
   -----------------------------------------
   Jisho NO envía cabeceras CORS, por eso fetch() desde el
   navegador falla siempre. Usamos kanjiapi.dev, que sí
   permite peticiones desde el navegador:
     /v1/kanji/{kanji}  -> on_readings, kun_readings, meanings
     /v1/words/{palabra} -> variants[{written, pronounced}], meanings
   ========================================= */

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchDictionary(item) {
  // Kanji: mantener kanjiapi.dev
  if (item.type === "kanji") {
    const data = await fetchJSON(
      "https://kanjiapi.dev/v1/kanji/" + encodeURIComponent(item.value)
    );

    const readings = new Set();

    for (const r of [
      ...(data.on_readings || []),
      ...(data.kun_readings || [])
    ]) {
      const full = normalizeReading(r);
      const stem = normalizeReading(r.split(".")[0]);

      if (full) readings.add(full);
      if (stem) readings.add(stem);
    }

    return {
      v: DICT_VERSION,
      source: "kanjiapi.dev",
      readings: [...readings],
      display: {
        on: data.on_readings || [],
        kun: data.kun_readings || []
      },
      meanings: (data.meanings || []).slice(0, 8),
      jlpt: data.jlpt ?? null
    };
  }

  // Palabras: intentar primero con Jisho
  try {
    const data = await fetchJSON(
      "https://jisho.org/api/v1/search/words?keyword=" +
      encodeURIComponent(item.value)
    );

    const readings = new Set();
    const meanings = new Set();
    const partsOfSpeech = new Set();
    const jlpt = new Set();

    for (const entry of data.data || []) {
      const japanese = entry.japanese || [];

      // Aceptar solo la escritura exacta solicitada.
      const matches = japanese.filter((variant) =>
        variant.word === item.value ||
        (!variant.word && variant.reading === item.value)
      );

      if (!matches.length) continue;

      for (const variant of matches) {
        const reading = normalizeReading(variant.reading);
        if (reading) readings.add(reading);
      }

      for (const sense of entry.senses || []) {
        for (const meaning of sense.english_definitions || []) {
          if (meaning) meanings.add(meaning);
        }

        for (const pos of sense.parts_of_speech || []) {
          if (pos) partsOfSpeech.add(pos);
        }

        for (const tag of sense.tags || []) {
          if (/^jlpt-n[1-5]$/i.test(tag)) {
            jlpt.add(tag.toLowerCase());
          }
        }
      }
    }

    if (readings.size) {
      return {
        v: DICT_VERSION,
        source: "jisho",
        readings: [...readings],
        display: {
          words: [...readings]
        },
        meanings: [...meanings].slice(0, 8),
        partsOfSpeech: [...partsOfSpeech],
        jlpt: [...jlpt]
      };
    }

    throw new Error("Jisho no encontró una coincidencia exacta");
  } catch (jishoError) {
    // Respaldo: intentar recuperar la palabra con kanjiapi.dev
    try {
      const entries = await fetchJSON(
        "https://kanjiapi.dev/v1/words/" +
        encodeURIComponent(item.value)
      );

      const readings = new Set();
      const meanings = new Set();

      for (const entry of entries) {
        const matches = (entry.variants || []).filter(
          (variant) => variant.written === item.value
        );

        if (!matches.length) continue;

        for (const variant of matches) {
          const reading = normalizeReading(variant.pronounced);
          if (reading) readings.add(reading);
        }

        for (const meaning of entry.meanings || []) {
          for (const gloss of meaning.glosses || []) {
            if (gloss) meanings.add(gloss);
          }
        }
      }

      if (!readings.size) {
        throw new Error("Sin lectura para esta palabra");
      }

      return {
        v: DICT_VERSION,
        source: "kanjiapi.dev",
        readings: [...readings],
        display: {
          words: [...readings]
        },
        meanings: [...meanings].slice(0, 8)
      };
    } catch (fallbackError) {
      throw new Error(
        `Jisho: ${jishoError.message}. ` +
        `kanjiapi.dev: ${fallbackError.message}`
      );
    }
  }
}

async function getDictionary(item) {
  if (item.dictionary?.v === DICT_VERSION) {
    return item.dictionary;
  }

  // Utilizar primero el diccionario que viene en el JSON.
  const imported = item.dictionary;

  if (imported && typeof imported.reading === "string" &&
      imported.reading.trim()) {
    const reading = normalizeReading(imported.reading);

    item.dictionary = {
      ...imported,
      v: DICT_VERSION,
      source: "import",
      readings: reading ? [reading] : [],
      display: item.type === "kanji"
        ? {
            on: [],
            kun: [],
            imported: [imported.reading]
          }
        : {
            words: [imported.reading]
          },
      meanings: Array.isArray(imported.meanings)
        ? imported.meanings
        : []
    };

    item.lookupStatus = "found";
    item.lookupDate = new Date().toISOString();
    delete item.lookupError;

    await saveItem(item);
    return item.dictionary;
  }

  // Si el JSON no contiene una lectura, recurrir a la API.
  try {
    item.dictionary = await fetchDictionary(item);
    item.lookupStatus = "found";
    item.lookupDate = new Date().toISOString();
    delete item.lookupError;
  } catch (error) {
    item.lookupStatus = "error";
    item.lookupError = error.message;
    await saveItem(item);
    return null;
  }

  await saveItem(item);
  return item.dictionary;
}

/* =========================================
   10. TARJETAS
   ========================================= */

function renderEnd() {
  $("studyArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>Sesión terminada</h3>
      <p>Has repasado ${session.length} elementos.</p>
      <button class="button button-outline" data-go="progress" type="button">Ver progreso</button>
    </div>`;
}

async function showCard() {
  if (sessionIndex >= session.length) return renderEnd();

  const item = session[sessionIndex];
  const area = $("studyArea");

  area.innerHTML = `<p class="message">Cargando…</p>`;
  const dict = await getDictionary(item);

  if (!dict?.readings?.length) {
    area.innerHTML = `
      <div class="empty-state">
        <h3>${escapeHTML(item.value)}</h3>
        <p>No se pudo obtener la lectura (${escapeHTML(item.lookupError || "sin datos")}).</p>
        <button id="retryBtn" class="button button-outline" type="button">Reintentar</button>
        <button id="skipBtn" class="button button-secondary" type="button">Saltar</button>
      </div>`;
    $("retryBtn").onclick = showCard;
    $("skipBtn").onclick = () => { sessionIndex++; showCard(); };
    return;
  }

  area.innerHTML = `
    <div class="card">
      <div class="card-progress">${sessionIndex + 1} / ${session.length}</div>
      <div class="card-symbol">${escapeHTML(item.value)}</div>
      <form id="readingForm" autocomplete="off">
        <input id="readingInput" class="reading-input" type="text"
  lang="ja" inputmode="text"
  placeholder="Escribe la lectura (hiragana o katakana)"
  autocapitalize="off" autocomplete="off" spellcheck="false">
        <button id="checkBtn" class="button button-primary" type="submit">Comprobar</button>
        <button id="skipBtn" class="button button-secondary" type="button">Saltar</button>
      </form>
      <p id="feedback" class="message"></p>
      <div id="answer"></div>
    </div>`;

  const form = $("readingForm");
  const input = $("readingInput");
  const checkButton = $("checkBtn");
  
  const feedback = $("feedback");
  const answer = $("answer");
  // Si WanaKana está cargado, "ka" se convierte en "か" al escribir
if (window.wanakana && typeof window.wanakana.bind === "function") {
  window.wanakana.bind(input);
} else {
  console.error("WanaKana no se ha cargado correctamente.");
}
$("skipBtn").onclick = async () => {
  if (answered) return;

  answered = true;
  input.disabled = true;
  checkButton.disabled = true;
  $("skipBtn").disabled = true;

  await grade(item, "skipped");

  sessionIndex++;
  await showCard();
};
  let answered = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (answered) return;

    const userAnswer = normalizeReading(input.value);
    if (!userAnswer) {
      feedback.textContent = "Escribe una lectura primero.";
      return;
    }
    answered = true;

    const correct = dict.readings.includes(userAnswer);
    feedback.textContent = correct ? "¡Correcto!" : "No es correcto.";
    feedback.className = `message ${correct ? "correct" : "incorrect"}`;

    input.disabled = true;
    checkButton.disabled = true;

    // La respuesta se queda en pantalla hasta pulsar "Siguiente"
   
const shown = item.type === "kanji"
  ? (
      dict.display.imported?.length
        ? `<p class="reading">${escapeHTML(dict.display.imported.join(" · "))}</p>`
        : `${dict.display.on.length
            ? `<p class="reading">On: ${escapeHTML(dict.display.on.join(" · "))}</p>`
            : ""}
           ${dict.display.kun.length
            ? `<p class="reading">Kun: ${escapeHTML(dict.display.kun.join(" · "))}</p>`
            : ""}`
    )
  : `<p class="reading">${escapeHTML(dict.display.words.join(" · "))}</p>`;

    answer.innerHTML = `
      ${shown}
      ${dict.meanings.length
        ? `<p class="meaning">${escapeHTML(dict.meanings.join(", "))}</p>` : ""}`;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "button button-primary";
    nextButton.textContent = "Siguiente";
    nextButton.addEventListener("click", async () => {
      sessionIndex++;
      await showCard();
    });
    answer.appendChild(nextButton);
    nextButton.focus(); // Enter otra vez = siguiente

    await grade(item, correct ? "good" : "again");
  });
}

/* =========================================
   11. REPETICIÓN ESPACIADA
   ========================================= */

async function grade(item, rating) {
  const intervals = {
    again: 0,
    hard: item.interval ? Math.max(1, Math.round(item.interval * 1.2)) : 1,
    good: item.interval ? Math.max(1, Math.round(item.interval * 2.2)) : 2,
    easy: item.interval ? Math.max(2, Math.round(item.interval * 3.5)) : 4
  };

  if (rating === "skipped") {
    item.skippedCount = (item.skippedCount || 0) + 1;
    item.interval = 1;
    item.status = "learning";
    item.nextReview = daysFromNow(1);
  } else if (rating === "again") {
    item.incorrectCount++;
    item.repetitions = 0;
    item.interval = 0;
    item.status = "learning";
    item.nextReview = daysFromNow(0);
  } else {
    item.correctCount++;
    item.repetitions++;
    item.interval = intervals[rating];
    item.status =
      item.repetitions >= 4 && item.interval >= 7
        ? "mature"
        : "learning";
    item.nextReview = daysFromNow(item.interval);
  }

  item.studied = true;
  item.lastReviewed = new Date().toISOString();
  await saveItem(item);

  // Si `items` se recargó durante la sesión, sustituye la copia obsoleta
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = item;

  updateCounts();
  renderStats();
}
/* =========================================
   12. EXPORTAR
   ========================================= */

async function exportData() {
  const payload = {
    app: "kanji-learning-app",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    items: await allItems(),
    settings: { studyType: $("studyType").value, studyLevel: $("studyLevel").value }
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kanji-learning-backup-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revocar de inmediato puede cancelar la descarga
}

/* =========================================
   13. IMPORTAR
   ========================================= */

/* Solo se copian campos conocidos (antes ...raw permitía sobrescribir cualquier cosa) */
function sanitizeRecord(raw) {
  const base = newItem(raw.type, raw.value.trim(), raw.level || "N3");

  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  const textOrArray = (value) => {
    if (Array.isArray(value)) {
      return value.filter((v) => typeof v === "string" && v.trim());
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    return [];
  };

  return {
    ...base,
    source: "import",
    reading: textOrArray(raw.reading),
    meaning: textOrArray(raw.meaning),
    dictionary: raw.dictionary && typeof raw.dictionary === "object"
      ? raw.dictionary
      : null,
    lookupStatus: raw.dictionary ? (raw.lookupStatus || "found") : "pending",
    studied: !!raw.studied,
    correctCount: num(raw.correctCount, 0),
    incorrectCount: num(raw.incorrectCount, 0),
    repetitions: num(raw.repetitions, 0),
    interval: num(raw.interval, 0),
    ease: num(raw.ease, 2.5),
    lastReviewed: raw.lastReviewed || null,
    nextReview: /^\d{4}-\d{2}-\d{2}$/.test(raw.nextReview)
      ? raw.nextReview
      : today(),
    status: ["new", "learning", "mature"].includes(raw.status)
      ? raw.status
      : base.status
  };
}
async function importData() {
  if (!pendingImport) return;
 
  try {
    const parsed = JSON.parse(await pendingImport.text());
 
    if (parsed.app !== "kanji-learning-app" ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.items)) {
      throw new Error("El archivo no tiene un formato compatible.");
    }
 
    const byId = new Map(items.map((i) => [i.id, i]));
    const toSave = [];
    let added = 0, updated = 0;
 
    for (const raw of parsed.items) {
      if (!raw || !["kanji", "word"].includes(raw.type) ||
          typeof raw.value !== "string" || !raw.value.trim()) continue;
 
      const clean = sanitizeRecord(raw);
      const existing = byId.get(clean.id);
 
      if (existing) {
        if (!existing.dictionary && clean.dictionary) {
          existing.dictionary = clean.dictionary;
          existing.lookupStatus = clean.lookupStatus;
        }
        if (!existing.studied && clean.studied) {
          Object.assign(existing, {
            studied: true,
            correctCount: clean.correctCount,
            incorrectCount: clean.incorrectCount,
            repetitions: clean.repetitions,
            interval: clean.interval,
            ease: clean.ease,
            lastReviewed: clean.lastReviewed,
            nextReview: clean.nextReview,
            status: clean.status === "new" ? "learning" : clean.status
          });
        }
        toSave.push(existing);
        updated++;
      } else {
        toSave.push(clean);
        byId.set(clean.id, clean);
        added++;
      }
    }
 
    if (toSave.length) await saveItems(toSave);
 
    $("importMessage").textContent =
      `Importación completada. Nuevos: ${added}; registros combinados: ${updated}.`;
    pendingImport = null;
    $("mergeBtn").disabled = true;
    $("importFile").value = "";
    await refresh();
 
  } catch (error) {
    $("importMessage").textContent = error.message || "No se pudo importar el archivo.";
  }
}
 
/* =========================================
   14. EVENTOS
   ========================================= */
 
$("importType").addEventListener("change", () => {
  const kanji = $("importType").value === "kanji";
  $("listLabel").textContent = kanji ? "Lista de kanjis" : "Lista de palabras";
  $("listInput").placeholder = kanji ? "政, 議, 民, 経, 済" : "政治, 政府, 行政";
});
 
$("addBtn").addEventListener("click", addList);
$("startBtn").addEventListener("click", startSession);
$("exportBtn").addEventListener("click", exportData);
$("filterInput").addEventListener("input", renderItems);
 
$("importFile").addEventListener("change", (event) => {
  pendingImport = event.target.files?.[0] || null;
  $("mergeBtn").disabled = !pendingImport;
  $("importMessage").textContent = pendingImport
    ? `Archivo seleccionado: ${pendingImport.name}` : "";
});
 
$("mergeBtn").addEventListener("click", importData);
 
/* =========================================
   15. INICIO
   ========================================= */
 
async function init() {
  try {
    db = await openDatabase();
    bindNavigation();
    bindDelete();
    await refresh();
  } catch (error) {
    console.error("Error al iniciar la aplicación:", error);
    $("studyArea").innerHTML = `
      <div class="empty-state">
        <h3>No se pudo abrir el almacenamiento local</h3>
        <p>Abre la aplicación desde un navegador compatible con IndexedDB.</p>
      </div>`;
  }
}
 
init();