
/* =========================================
   KANJI LEARNING APP
   JavaScript principal
   ========================================= */

const DB_NAME = "kanji-learning-app";
const DB_VERSION = 1;

let db;
let items = [];
let session = [];
let sessionIndex = 0;
let pendingImport = null;

const $ = (id) => document.getElementById(id);

const today = () => new Date().toISOString().slice(0, 10);

const uid = (type, value) =>
  `${type}:${value.normalize("NFKC")}`;

/* =========================================
   1. BASE DE DATOS INDEXEDDB
   ========================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("items")) {
        const store = database.createObjectStore("items", {
          keyPath: "id"
        });

        store.createIndex("type", "type", { unique: false });
        store.createIndex("level", "level", { unique: false });
        store.createIndex("nextReview", "nextReview", {
          unique: false
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function allItems() {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("items", "readonly")
      .objectStore("items")
      .getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveItem(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");

    tx.objectStore("items").put(item);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function deleteItem(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");

    tx.objectStore("items").delete(id);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================
   2. FUNCIONES AUXILIARES
   ========================================= */

function normalizeText(value) {
  return String(value ?? "").trim().normalize("NFKC");
}

function isKanji(character) {
  return /\p{Script=Han}/u.test(character);
}

function splitKanji(word) {
  return [...new Set([...word].filter(isKanji))];
}

function splitInput(value) {
  return [
    ...new Set(
      value
        .split(/[,，;；\n\r]+/)
        .map(normalizeText)
        .filter(Boolean)
    )
  ];
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/* =========================================
   3. NAVEGACIÓN
   ========================================= */

function switchView(name) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("hidden", view.id !== `view-${name}`);
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === name);
  });

  if (name === "manage") renderItems();
  if (name === "progress") renderStats();
}

function bindNavigation() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      switchView(tab.dataset.view);
    });
  });

  document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => {
      switchView(button.dataset.go);
    });
  });
}

/* =========================================
   4. ACTUALIZAR DATOS DE LA INTERFAZ
   ========================================= */

async function refresh() {
  items = await allItems();

  updateCounts();
  renderItems();
  renderStats();
}

function updateCounts() {
  const due = items.filter(item =>
    item.studied && item.nextReview <= today()
  );

  $("itemCount").textContent = `${items.length} elementos`;
  $("dueBadge").textContent = `${due.length} pendientes`;
}

/* =========================================
   5. AGREGAR KANJIS Y PALABRAS
   ========================================= */

function newItem(type, value, level) {
  return {
    id: uid(type, value),
    type,
    value,
    level,

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
    $("addMessage").textContent =
      "Introduce al menos un elemento.";
    return;
  }

  let added = 0;
  let skipped = 0;
  let invalid = 0;

  for (const value of values) {
    if (
      type === "kanji" &&
      ([...value].length !== 1 || !isKanji(value))
    ) {
      invalid++;
      continue;
    }

    const id = uid(type, value);

    if (items.some(item => item.id === id)) {
      skipped++;
      continue;
    }

    await saveItem(newItem(type, value, level));
    added++;
  }

  $("listInput").value = "";

  $("addMessage").textContent =
    `Agregados: ${added}. Ya existentes: ${skipped}.` +
    (invalid ? ` Formato no válido: ${invalid}.` : "");

  await refresh();
}

/* =========================================
   6. MOSTRAR ELEMENTOS GUARDADOS
   ========================================= */

function renderItems() {
  if (!items.length) {
    $("itemsList").innerHTML = `
      <div class="no-items">
        Todavía no has agregado kanjis ni palabras.
      </div>`;
    return;
  }

  const filter = normalizeText($("filterInput").value)
    .toLowerCase();

  const filtered = items
    .filter(item =>
      `${item.value} ${item.level} ${item.type}`
        .toLowerCase()
        .includes(filter)
    )
    .sort((a, b) => a.value.localeCompare(b.value));

  if (!filtered.length) {
    $("itemsList").innerHTML = `
      <div class="no-items">
        No se encontraron elementos.
      </div>`;
    return;
  }

  $("itemsList").innerHTML = filtered.map(item => `
    <article class="item-row">
      <div class="item-symbol">
        ${escapeHTML(item.value)}
      </div>

      <div class="item-info">
        <div class="item-title">
          ${escapeHTML(item.value)}
        </div>

        <div class="item-sub">
          ${item.type === "kanji" ? "Kanji" : "Palabra"}
          · ${escapeHTML(item.level)}
          · ${
            item.dictionary?.reading
              ? escapeHTML(item.dictionary.reading)
              : item.lookupStatus === "found"
                ? "Información guardada"
                : "Información pendiente"
          }
        </div>
      </div>

      <div class="item-state">
        ${item.studied
          ? `Repasos: ${item.repetitions}`
          : "Sin estudiar"}
      </div>

      <button
        class="delete-btn"
        data-delete="${escapeHTML(item.id)}"
        title="Eliminar"
        aria-label="Eliminar ${escapeHTML(item.value)}">
        ×
      </button>
    </article>
  `).join("");

  $("itemsList")
    .querySelectorAll("[data-delete]")
    .forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.delete;
        const value = id.split(":").slice(1).join(":");

        if (confirm(`¿Eliminar ${value} y su progreso?`)) {
          await deleteItem(id);
          await refresh();
        }
      });
    });
}

/* =========================================
   7. ESTADÍSTICAS
   ========================================= */

function renderStats() {
  const studied = items.filter(item => item.studied);

  const due = studied.filter(item =>
    item.nextReview <= today()
  );

  const mature = items.filter(item =>
    item.status === "mature"
  );

  $("statTotal").textContent = items.length;
  $("statStudied").textContent = studied.length;
  $("statDue").textContent = due.length;
  $("statMature").textContent = mature.length;
}

/* =========================================
   8. SELECCIÓN DE PREGUNTAS
   ========================================= */

function chooseSession() {
  const type = $("studyType").value;
  const level = $("studyLevel").value;
  const count = Number($("studyCount").value);

  const candidates = items.filter(item =>
    (type === "mixed" || item.type === type) &&
    (level === "ALL" || item.level === level)
  );

  const due = candidates.filter(item =>
    item.studied && item.nextReview <= today()
  );

  const fresh = candidates.filter(item =>
    !item.studied
  );

  const later = candidates.filter(item =>
    item.studied && item.nextReview > today()
  );

  let pool = [
    ...shuffle(due),
    ...shuffle(fresh),
    ...shuffle(later)
  ];

  if (count > 0) {
    pool = pool.slice(0, count);
  }

  return pool;
}

async function startSession() {
  session = chooseSession();
  sessionIndex = 0;

  if (!session.length) {
    $("studyArea").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <h3>No hay elementos en esta selección</h3>
        <p>
          Agrega contenido de ese tipo y nivel
          en “Mis listas”.
        </p>
        <button class="button button-outline"
          data-go="manage" type="button">
          Administrar listas
        </button>
      </div>`;

    bindNavigation();
    return;
  }

  await showCard();
}

/* =========================================
   9. CONSULTAR JISHO
   ========================================= */

async function lookupJisho(item) {
  if (item.dictionary) {
    return item.dictionary;
  }

  if (item.lookupStatus === "loading") {
    return null;
  }

  item.lookupStatus = "loading";
  await saveItem(item);

  const endpoint =
    "https://jisho.org/api/v1/search/words?keyword=" +
    encodeURIComponent(item.value);

  try {
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const entries = data.data || [];

    const entry = entries.find(result => {
      const forms = (result.japanese || [])
        .flatMap(japanese => [
          japanese.word,
          japanese.reading
        ])
        .filter(Boolean);

      return forms.includes(item.value);
    }) || entries[0];

    if (!entry) {
      throw new Error("No se encontró una entrada");
    }

    const japanese = entry.japanese?.[0] || {};
    const senses = entry.senses || [];

    const dictionary = {
      reading: japanese.reading || "",
      written: japanese.word || item.value,

      meanings: senses
        .flatMap(sense => sense.english_definitions || [])
        .slice(0, 8),

      partsOfSpeech: [
        ...new Set(
          senses.flatMap(sense =>
            sense.parts_of_speech || []
          )
        )
      ],

      jlpt: entry.jlpt || [],
      tags: entry.tags || []
    };

    item.dictionary = dictionary;
    item.lookupStatus = "found";
    item.lookupDate = new Date().toISOString();

    await saveItem(item);

    return dictionary;

  } catch (error) {
    item.lookupStatus = "error";
    item.lookupError = error.message;

    await saveItem(item);

    return null;
  }
}

/* =========================================
   10. EXTRAER KANJIS DE LAS PALABRAS
   ========================================= */

async function ensureRelatedKanji(wordItem) {
  const characters = splitKanji(wordItem.value);

  for (const character of characters) {
    const id = uid("kanji", character);

    if (!items.some(item => item.id === id)) {
      const created = newItem(
        "kanji",
        character,
        wordItem.level
      );

      created.source = "derived-from-word";

      await saveItem(created);
      items.push(created);
    }
  }
}

/* =========================================
   11. MOSTRAR TARJETAS
   ========================================= */

async function showCard() {
  const item = session[sessionIndex];

  if (!item) {
    $("studyArea").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">達</div>
        <h3>¡Sesión completada!</h3>
        <p>Has terminado ${session.length} preguntas.</p>
        <button class="button button-primary" id="againBtn">
          Volver a estudiar
        </button>
      </div>`;

    $("againBtn").addEventListener("click", startSession);

    await refresh();
    return;
  }

  if (item.type === "word") {
    await ensureRelatedKanji(item);
  }

  $("studyArea").innerHTML = `
    <article class="card-study">
      <div class="card-meta">
        <span>
          ${item.type === "kanji" ? "KANJI" : "VOCABULARIO"}
          · ${escapeHTML(item.level)}
        </span>
        <span>${sessionIndex + 1} / ${session.length}</span>
      </div>

      <div class="prompt ${item.type === "word" ? "word" : ""}">
        ${escapeHTML(item.value)}
      </div>

      <p id="lookupStatus" class="loading">
        Buscando información si es necesario…
      </p>

      <div id="answer" class="answer"></div>

      <div class="card-actions" id="cardActions">
        <button class="button button-outline" id="revealBtn">
          Revelar respuesta
        </button>
      </div>
    </article>
  `;

  const dictionary = await lookupJisho(item);

  const status = $("lookupStatus");
  const answer = $("answer");

  if (!status || !answer) return;

  status.textContent = dictionary
    ? "Información disponible"
    : "No se pudo recuperar información de Jisho.";

  $("revealBtn").addEventListener("click", () => {
    if (dictionary) {
      answer.innerHTML = `
        <p class="reading">
          ${escapeHTML(dictionary.reading || "Lectura no disponible")}
        </p>

        <p class="meaning">
          ${escapeHTML(
            (dictionary.meanings || []).join(" · ") ||
            "Significado no disponible"
          )}
        </p>

        <p class="details">
          ${escapeHTML(
            (dictionary.partsOfSpeech || []).join(" · ")
          )}
        </p>
      `;
    } else {
      answer.innerHTML = `
        <p class="details">
          Información no disponible.
          Comprueba tu conexión e inténtalo de nuevo.
        </p>
        <button id="retryBtn" class="button button-outline">
          Reintentar búsqueda
        </button>
      `;

      $("retryBtn").addEventListener("click", async () => {
        item.lookupStatus = "pending";
        await saveItem(item);
        await showCard();
      });
    }

    $("cardActions").innerHTML = `
      <button class="button button-wrong" data-grade="again">
        Otra vez
      </button>
      <button class="button button-hard" data-grade="hard">
        Difícil
      </button>
      <button class="button button-good" data-grade="good">
        Bien
      </button>
      <button class="button button-easy" data-grade="easy">
        Fácil
      </button>
    `;

    bindGrades();
  });
}

/* =========================================
   12. REPETICIÓN ESPACIADA BÁSICA
   ========================================= */

function bindGrades() {
  document.querySelectorAll("[data-grade]").forEach(button => {
    button.addEventListener("click", () => {
      grade(
        session[sessionIndex],
        button.dataset.grade
      );
    });
  });
}

async function grade(item, rating) {
  const intervals = {
    again: 0,
    hard: item.interval
      ? Math.max(1, Math.round(item.interval * 1.2))
      : 1,
    good: item.interval
      ? Math.max(1, Math.round(item.interval * 2.2))
      : 2,
    easy: item.interval
      ? Math.max(2, Math.round(item.interval * 3.5))
      : 4
  };

  if (rating === "again") {
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

  items = await allItems();
  sessionIndex++;

  updateCounts();
  renderStats();

  await showCard();
}

/* =========================================
   13. EXPORTAR JSON
   ========================================= */

async function exportData() {
  const data = await allItems();

  const payload = {
    app: "kanji-learning-app",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),

    items: data,

    settings: {
      studyType: $("studyType").value,
      studyLevel: $("studyLevel").value
    }
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `kanji-learning-backup-${today()}.json`;

  link.click();

  URL.revokeObjectURL(url);
}

/* =========================================
   14. IMPORTAR JSON
   ========================================= */

async function importData() {
  if (!pendingImport) return;

  try {
    const parsed = JSON.parse(
      await pendingImport.text()
    );

    if (
      parsed.app !== "kanji-learning-app" ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.items)
    ) {
      throw new Error(
        "El archivo no tiene un formato compatible."
      );
    }

    let added = 0;
    let updated = 0;

    for (const raw of parsed.items) {
      if (
        !raw ||
        !["kanji", "word"].includes(raw.type) ||
        typeof raw.value !== "string" ||
        !raw.value.trim()
      ) {
        continue;
      }

      const id = uid(raw.type, raw.value);

      const existing = items.find(
        item => item.id === id
      );

      if (existing) {
        if (!existing.dictionary && raw.dictionary) {
          existing.dictionary = raw.dictionary;
          existing.lookupStatus =
            raw.lookupStatus || "found";
        }

        if (!existing.studied && raw.studied) {
          Object.assign(existing, {
            studied: raw.studied,
            correctCount: raw.correctCount || 0,
            incorrectCount: raw.incorrectCount || 0,
            repetitions: raw.repetitions || 0,
            interval: raw.interval || 0,
            ease: raw.ease || 2.5,
            lastReviewed: raw.lastReviewed || null,
            nextReview: raw.nextReview || today(),
            status: raw.status || "learning"
          });
        }

        await saveItem(existing);
        updated++;

      } else {
        const newRecord = {
          ...newItem(
            raw.type,
            raw.value,
            raw.level || "N3"
          ),
          ...raw,
          id
        };

        await saveItem(newRecord);
        added++;
      }
    }

    $("importMessage").textContent =
      `Importación completada. Nuevos: ${added}; ` +
      `registros combinados: ${updated}.`;

    pendingImport = null;
    $("mergeBtn").disabled = true;
    $("importFile").value = "";

    await refresh();

  } catch (error) {
    $("importMessage").textContent =
      error.message || "No se pudo importar el archivo.";
  }
}

/* =========================================
   15. EVENTOS DE LA INTERFAZ
   ========================================= */

$("importType").addEventListener("change", () => {
  const isKanji = $("importType").value === "kanji";

  $("listLabel").textContent = isKanji
    ? "Lista de kanjis"
    : "Lista de palabras";

  $("listInput").placeholder = isKanji
    ? "政, 議, 民, 経, 済"
    : "政治, 政府, 行政";
});

$("addBtn").addEventListener("click", addList);

$("startBtn").addEventListener("click", startSession);

$("exportBtn").addEventListener("click", exportData);

$("filterInput").addEventListener("input", renderItems);

$("importFile").addEventListener("change", event => {
  pendingImport = event.target.files?.[0] || null;

  $("mergeBtn").disabled = !pendingImport;

  $("importMessage").textContent = pendingImport
    ? `Archivo seleccionado: ${pendingImport.name}`
    : "";
});

$("mergeBtn").addEventListener("click", importData);

/* =========================================
   16. INICIAR APLICACIÓN
   ========================================= */

async function init() {
  try {
    db = await openDatabase();

    await refresh();

    bindNavigation();

  } catch (error) {
    console.error("Error al iniciar la aplicación:", error);

    $("studyArea").innerHTML = `
      <div class="empty-state">
        <h3>No se pudo abrir el almacenamiento local</h3>
        <p>
          Abre la aplicación desde un navegador
          compatible con IndexedDB.
        </p>
      </div>`;
  }
}

init();