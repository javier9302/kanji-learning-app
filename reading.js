/* =========================================
   KANJI LEARNING APP - reading.js
   Lectura: textos tokenizados, diccionario de palabras y biblioteca.
   Se carga antes que app.js y usa sus funciones (db, items, t, $…).

   Almacenes de IndexedDB (se crean en openDatabase, app.js):
     texts      { id, title, titleEn, titleEs, topic, level, source, status,
                  createdAt, updatedAt, readAt, lemmas: {clave: veces}, total, data }
     words      { id: "lemma|lectura", lemma, reading, meanings, meaningsEs,
                  pos, source: "ai" | "jmdict" | "user", updatedAt }
     userWords  progreso del usuario por palabra (se rellena al leer)
     sessions   sesiones de lectura (se rellenan al leer)
   ========================================= */

const READING_STORES = ["texts", "words", "userWords", "sessions"];
const MAX_SHOWN_ERRORS = 12;

/* Tipos de palabra admitidos en los tokens */
const TOKEN_POS = [
  "noun", "proper_noun", "pronoun", "verb", "i_adjective", "na_adjective", "adverb",
  "particle", "auxiliary", "conjunction", "interjection", "determiner", "counter",
  "number", "prefix", "suffix", "expression", "punctuation", "symbol"
];
/* Variantes habituales que escriben las IA */
const POS_ALIASES = {
  adjective: "i_adjective", adj_i: "i_adjective", adj_na: "na_adjective",
  auxiliary_verb: "auxiliary", aux: "auxiliary", copula: "auxiliary",
  name: "proper_noun", numeral: "number", punct: "punctuation",
  adnominal: "determiner", pre_noun_adjectival: "determiner", phrase: "expression"
};
/* No cuentan para la cobertura ni se guardan como vocabulario */
const UNCOUNTED_POS = new Set(
  ["particle", "auxiliary", "punctuation", "symbol", "number", "proper_noun"]);

let texts = [];
let deletedTexts = [];     // textos propios borrados: { id, owner, deletedAt } hasta avisar al servidor
let words = new Map();     // id -> palabra del diccionario
let userWords = new Map(); // id -> progreso del usuario

const wordKey = (lemma, reading) => `${normalizeText(lemma)}|${normalizeReading(reading)}`;
const isKana = (value) => /^[぀-ヿー]+$/.test(value);
const newId = () => crypto.randomUUID?.() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* =========================================
   1. ALMACENAMIENTO
   ========================================= */

function putRecords(storeName, records = [], deleteIds = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    records.forEach((record) => store.put(record));
    deleteIds.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function loadReadingData() {
  const all = await getAll("texts");
  texts = all.filter((text) => !text.deletedAt);
  deletedTexts = all.filter((text) => text.deletedAt);
  words = new Map((await getAll("words")).map((w) => [w.id, w]));
  userWords = new Map((await getAll("userWords")).map((w) => [w.id, w]));
}

/* Vacía todo lo de lectura (al cambiar de cuenta en el dispositivo) */
async function clearReadingData() {
  for (const name of READING_STORES) {
    await putRecords(name, [], (await getAll(name)).map((record) => record.id));
  }
  texts = [];
  deletedTexts = [];
  words = new Map();
  userWords = new Map();
}

/* =========================================
   2. VALIDADOR DEL JSON DE UN TEXTO
   -----------------------------------------
   validateText(texto pegado) -> { errors: [mensajes], text: JSON normalizado }
   ========================================= */

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isList = (value) => Array.isArray(value) && value.length > 0;

function normalizePos(pos) {
  const key = String(pos ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TOKEN_POS.includes(key) ? key : POS_ALIASES[key] || null;
}

/* Las IA suelen envolver el JSON en ```json … ``` o añadir una frase alrededor */
function extractJSON(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function validateText(raw) {
  const errors = [];
  const fail = (text, params) => errors.push(t(text, params));

  let data;
  try {
    data = JSON.parse(extractJSON(String(raw)));
  } catch (error) {
    return { errors: [t("No es un JSON válido: {error}", { error: error.message })], text: null };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: [t("El JSON debe ser un objeto con “title”, “level” y “sentences”.")], text: null };
  }

  for (const field of ["title", "title_en", "title_es", "topic"]) {
    if (!isText(data[field])) fail("Falta el campo “{field}” (texto no vacío).", { field });
  }
  if (!LEVELS.includes(data.level)) fail("“level” debe ser uno de: N5, N4, N3, N2, N1.");
  if (!isList(data.sentences)) {
    fail("“sentences” debe ser una lista con al menos una oración.");
    return { errors, text: null };
  }

  // Las palabras pueden estar explicadas en el diccionario de cualquier oración
  const dictionary = new Map();
  data.sentences.forEach((sentence, index) => {
    const n = index + 1;
    const entries = sentence?.dictionary;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return;
    for (const [lemma, entry] of Object.entries(entries)) {
      const where = { n, lemma };
      if (!entry || typeof entry !== "object") { fail("Oración {n}, dictionary “{lemma}”: debe ser un objeto.", where); continue; }
      if (!isText(entry.reading) || !isKana(normalizeText(entry.reading))) {
        fail("Oración {n}, dictionary “{lemma}”: “reading” debe estar en kana.", where);
      }
      for (const field of ["meanings", "meanings_es"]) {
        if (!isList(entry[field]) || !entry[field].every(isText)) {
          fail("Oración {n}, dictionary “{lemma}”: “{field}” debe ser una lista de textos.", { ...where, field });
        }
      }
      if (!dictionary.has(lemma)) dictionary.set(lemma, entry);
    }
  });

  const ids = new Set();
  const sentences = data.sentences.map((sentence, index) => {
    const n = index + 1;
    if (!sentence || typeof sentence !== "object") {
      fail("Oración {n}: debe ser un objeto.", { n });
      return null;
    }
    if (!Number.isInteger(sentence.id) || ids.has(sentence.id)) {
      fail("Oración {n}: “id” debe ser un número entero que no se repita.", { n });
    }
    ids.add(sentence.id);
    if (sentence.paragraph !== undefined && !(Number.isInteger(sentence.paragraph) && sentence.paragraph > 0)) {
      fail("Oración {n}: “paragraph” debe ser un número entero mayor que 0.", { n });
    }
    for (const field of ["jp", "en", "es"]) {
      if (!isText(sentence[field])) fail("Oración {n}: falta “{field}”.", { n, field });
    }
    if (!sentence.dictionary || typeof sentence.dictionary !== "object" || Array.isArray(sentence.dictionary)) {
      fail("Oración {n}: falta “dictionary” (objeto con las palabras de la oración).", { n });
    }
    if (!isList(sentence.tokens)) {
      fail("Oración {n}: “tokens” debe ser una lista no vacía.", { n });
      return null;
    }

    const tokens = sentence.tokens.map((token, tokenIndex) => {
      const where = { n, i: tokenIndex + 1, surface: token?.surface ?? "?" };
      for (const field of ["surface", "lemma", "reading", "pos"]) {
        if (!isText(token?.[field])) fail("Oración {n}, token {i} ({surface}): falta “{field}”.", { ...where, field });
      }
      if (!token || !isText(token.surface)) return null;

      const pos = normalizePos(token.pos);
      if (isText(token.pos) && !pos) {
        fail("Oración {n}, token {i} ({surface}): “pos” no admite “{pos}”. Valores: {list}.",
          { ...where, pos: token.pos, list: TOKEN_POS.join(", ") });
      }
      const silent = pos === "punctuation" || pos === "symbol" || pos === "number";
      if (isText(token.reading) && !silent && !isKana(normalizeText(token.reading))) {
        fail("Oración {n}, token {i} ({surface}): “reading” debe estar en kana.", where);
      }
      if (pos && !UNCOUNTED_POS.has(pos) && isText(token.lemma) && !dictionary.has(token.lemma)) {
        fail("Oración {n}: falta “{lemma}” en “dictionary”.", { n, lemma: token.lemma });
      }
      return { surface: token.surface, lemma: token.lemma, reading: token.reading, pos };
    });

    if (isText(sentence.jp) && tokens.every(Boolean)) {
      const joined = tokens.map((token) => token.surface).join("");
      if (joined !== sentence.jp) {
        let at = 0;
        while (at < joined.length && joined[at] === sentence.jp[at]) at++;
        fail("Oración {n}: los tokens no reproducen “jp”. Coinciden hasta “{same}”; después “jp” sigue con “{jp}” y los tokens con “{tokens}”.", {
          n,
          same: sentence.jp.slice(Math.max(0, at - 8), at),
          jp: sentence.jp.slice(at, at + 8) || "∅",
          tokens: joined.slice(at, at + 8) || "∅"
        });
      }
    }
    return {
      id: sentence.id, jp: sentence.jp, en: sentence.en, es: sentence.es,
      ...(sentence.paragraph ? { paragraph: sentence.paragraph } : {}),
      tokens, dictionary: sentence.dictionary
    };
  });

  const unique = [...new Set(errors)];
  if (unique.length) return { errors: unique, text: null };

  return {
    errors: [],
    text: {
      title: data.title.trim(), title_en: data.title_en.trim(), title_es: data.title_es.trim(),
      topic: data.topic.trim(), level: data.level,
      ...(isText(data.type) ? { type: data.type.trim() } : {}),
      sentences
    }
  };
}

/* =========================================
   3. GUARDAR UN TEXTO
   ========================================= */

/* Palabras que cuentan para la cobertura: { "lemma|lectura": veces } */
function countLemmas(data) {
  const lemmas = {};
  let total = 0;
  const dictionary = {};
  for (const sentence of data.sentences) Object.assign(dictionary, sentence.dictionary);
  for (const sentence of data.sentences) {
    for (const token of sentence.tokens) {
      if (UNCOUNTED_POS.has(token.pos)) continue;
      const key = wordKey(token.lemma, dictionary[token.lemma].reading);
      lemmas[key] = (lemmas[key] || 0) + 1;
      total++;
    }
  }
  return { lemmas, total };
}

/* Las palabras del texto entran en el diccionario; lo ya guardado no se pisa */
function wordsFromText(data) {
  const fresh = [];
  for (const sentence of data.sentences) {
    for (const [lemma, entry] of Object.entries(sentence.dictionary)) {
      const id = wordKey(lemma, entry.reading);
      if (words.has(id)) continue;
      const word = {
        id,
        lemma: normalizeText(lemma),
        reading: normalizeText(entry.reading),
        meanings: entry.meanings.map((m) => m.trim()),
        meaningsEs: entry.meanings_es.map((m) => m.trim()),
        pos: isText(entry.pos) ? entry.pos.trim() : "",
        source: "ai",
        updatedAt: Date.now()
      };
      words.set(id, word);
      fresh.push(word);
    }
  }
  return fresh;
}

async function saveText(data, source = "manual") {
  const first = data.sentences[0].jp;
  if (texts.some((x) => x.title === data.title && x.data.sentences[0].jp === first)) {
    throw new Error(t("Ese texto ya está en tu biblioteca."));
  }
  const now = Date.now();
  const record = {
    id: newId(),
    title: data.title, titleEn: data.title_en, titleEs: data.title_es,
    topic: data.topic, level: data.level,
    source,
    owner: "",         // se rellena al subirlo con la sesión iniciada
    status: "private", // al subirlo pasa a "pending"; un administrador lo aprueba
    createdAt: now, updatedAt: now, readAt: null,
    ...countLemmas(data),
    data
  };
  await putRecords("texts", [record]);
  await putRecords("words", wordsFromText(data));
  texts.push(record);
  scheduleSync();
  return record;
}

/* Un texto propio se borra para todos; uno de otro usuario solo se oculta aquí */
async function deleteText(id) {
  const text = texts.find((x) => x.id === id);
  if (reader?.text === text) reader = null; // por si se quita desde la biblioteca mientras está abierto
  if (isOwnText(text)) {
    const gone = { id, owner: text.owner, deletedAt: Date.now() };
    await putRecords("texts", [gone]);
    texts = texts.filter((x) => x !== text);
    deletedTexts.push(gone);
  } else {
    text.hiddenAt = Date.now();
    await putRecords("texts", [text]);
  }
  scheduleSync();
}

/* =========================================
   5. BIBLIOTECA
   ========================================= */

const SAMPLE_TEXT = {
  title: "毎朝のコーヒー", title_en: "Morning coffee", title_es: "El café de cada mañana",
  topic: "daily life", level: "N5",
  sentences: [{
    id: 1,
    jp: "私は毎朝コーヒーを飲みます。",
    en: "I drink coffee every morning.",
    es: "Bebo café todas las mañanas.",
    tokens: [
      { surface: "私", lemma: "私", reading: "わたし", pos: "pronoun" },
      { surface: "は", lemma: "は", reading: "は", pos: "particle" },
      { surface: "毎朝", lemma: "毎朝", reading: "まいあさ", pos: "noun" },
      { surface: "コーヒー", lemma: "コーヒー", reading: "コーヒー", pos: "noun" },
      { surface: "を", lemma: "を", reading: "を", pos: "particle" },
      { surface: "飲みます", lemma: "飲む", reading: "のみます", pos: "verb" },
      { surface: "。", lemma: "。", reading: "。", pos: "punctuation" }
    ],
    dictionary: {
      "私": { reading: "わたし", meanings: ["I", "me"], meanings_es: ["yo"], pos: "pronoun" },
      "毎朝": { reading: "まいあさ", meanings: ["every morning"], meanings_es: ["todas las mañanas"], pos: "noun" },
      "コーヒー": { reading: "コーヒー", meanings: ["coffee"], meanings_es: ["café"], pos: "noun" },
      "飲む": { reading: "のむ", meanings: ["to drink"], meanings_es: ["beber"], pos: "godan verb" }
    }
  }]
};

function renderLibrary() {
  const list = $("textList");
  const visible = texts.filter((text) => !text.hiddenAt);
  $("textCount").textContent = plural(visible.length, "texto", "textos");
  $("libraryEmpty").classList.toggle("hidden", visible.length > 0);
  const shareTag = (text) => !isOwnText(text) ? t("De la comunidad")
    : text.status === "approved" ? t("Compartido")
    : text.status === "rejected" ? t("No aprobado")
    : text.status === "pending" ? t("Pendiente de aprobación") : "";

  const known = knownLemmas();
  list.innerHTML = visible.sort((a, b) => b.createdAt - a.createdAt).map((text) => {
    const title = lang === "es" ? text.titleEs : text.titleEn;
    const date = new Date(text.createdAt).toLocaleDateString(lang, { day: "numeric", month: "short" });
    return `
    <article class="item-row text-row">
      <div class="item-info">
        <div class="item-title" lang="ja">${escapeHTML(text.title)}</div>
        <div class="item-sub">
          ${escapeHTML(title)} · ${escapeHTML(text.level)} · ${escapeHTML(text.topic)} · ${date}${
            shareTag(text) ? ` · ${shareTag(text)}` : ""}
        </div>
      </div>
      <div class="item-state">
        ${t("{percent} % conocido", { percent: textCoverage(text, known) })}<br>
        ${text.readAt ? t("Leído") : text.discardedAt ? t("Descartado") : t("Sin leer")}
      </div>
      <button class="button button-outline" type="button" data-read-text="${escapeHTML(text.id)}">${t("Leer")}</button>
      <button class="icon-btn delete-btn" data-delete-text="${escapeHTML(text.id)}"
        title="${t("Eliminar")}" aria-label="${t("Eliminar")} ${escapeHTML(text.title)}">×</button>
    </article>`;
  }).join("");
}

function showTextErrors(errors, target = $("textMessage")) {
  const shown = errors.slice(0, MAX_SHOWN_ERRORS);
  const more = errors.length - shown.length;
  target.className = "message incorrect";
  target.innerHTML = `
    ${t("El texto no se guardó. Hay que corregir esto:")}
    <ul class="error-list">
      ${shown.map((error) => `<li>${escapeHTML(error)}</li>`).join("")}
      ${more > 0 ? `<li>${t("…y {n} más.", { n: more })}</li>` : ""}
    </ul>`;
}

async function addTextFromInput() {
  const raw = $("textInput").value;
  if (!raw.trim()) {
    $("textMessage").className = "message";
    $("textMessage").textContent = t("Pega primero el JSON del texto.");
    return;
  }

  if (pendingOwnText()) {
    return showTextErrors([t("Tienes un texto sin terminar ({title}). Léelo o sáltalo antes de agregar otro.", { title: pendingOwnText().title })]);
  }
  const { errors, text } = validateText(raw);
  if (errors.length) return showTextErrors(errors);

  try {
    const record = await saveText(text);
    $("textInput").value = "";
    $("textMessage").className = "message correct";
    $("textMessage").textContent = t("Texto guardado: {title} ({n}).", {
      title: record.title,
      n: plural(record.data.sentences.length, "oración", "oraciones")
    });
    renderLibrary();
  } catch (error) {
    showTextErrors([error.message]);
  }
}

function bindLibrary() {
  $("addTextBtn").addEventListener("click", addTextFromInput);
  $("sampleTextBtn").addEventListener("click", () => {
    $("textInput").value = JSON.stringify(SAMPLE_TEXT, null, 2);
    $("textMessage").textContent = "";
  });
  $("textList").addEventListener("click", async (event) => {
    const read = event.target.closest("[data-read-text]");
    if (read) return openText(read.dataset.readText);
    const button = event.target.closest("[data-delete-text]");
    if (!button) return;
    const text = texts.find((x) => x.id === button.dataset.deleteText);
    if (!text) return;
    // Quitar un texto propio sin leer es saltarlo: cuenta para el máximo
    const skipping = isOwnText(text) && !text.readAt;
    if (skipping && await skipsUsed() >= MAX_SKIPS) {
      return alert(t("Ya saltaste {n} textos seguidos: termina este para poder crear otro.", { n: MAX_SKIPS }));
    }
    if (confirm(t("¿Eliminar el texto “{title}”?", { title: text.title }))) {
      if (skipping) await skipText(text); else await deleteText(text.id);
      renderLibrary();
    }
  });
}

/* =========================================
   6. PERFIL DE LECTURA Y PALABRAS CONOCIDAS
   -----------------------------------------
   meta.reading = { level, assumed, placedAt }
     level    nivel de los textos que se le proponen
     assumed  hasta qué nivel JLPT se da el vocabulario por conocido
              ("" = ninguno). Evita guardar miles de filas pre_known.
   ========================================= */

const KNOWN_STATUS = new Set(["mastered", "pre_known"]);
const COVERAGE_TARGET = 90;   // % mínimo de palabras conocidas para proponer un texto
const HARD_RATIO = 0.15;      // palabras marcadas como no conocidas a partir de las que el texto es difícil
const PLACEMENT_SIZE = 20;
const PLACEMENT_PASS = 0.7;

/* Vocabulario de un nivel: sus listas de palabras y las anclas de sus kanjis */
const levelVocabulary = (() => {
  const cache = {};
  return (level) => cache[level] ??= (() => {
    const list = new Map(); // palabra -> { lemma, reading, en, es } (si se conoce)
    for (const word of JLPT_WORDS[level].split(",")) list.set(word, null);
    // Palabras de un solo kanji: su nivel es el de la palabra, no el del kanji
    for (const word of JLPT_SINGLE_WORDS[level]) {
      const data = KANJI_DATA[word];
      list.set(word, data?.w === word ? { lemma: word, reading: data.r, en: data.en, es: data.es } : null);
    }
    for (const kanji of JLPT_KANJI[level]) {
      const data = KANJI_DATA[kanji];
      if (data) list.set(data.w, { lemma: data.w, reading: data.r, en: data.en, es: data.es });
    }
    return list;
  })();
})();

const assumedLevels = () => LEVELS.slice(0, LEVELS.indexOf(meta.reading.assumed) + 1);

function knownLemmas() {
  const known = new Set();
  for (const level of assumedLevels()) {
    for (const word of levelVocabulary(level).keys()) known.add(word);
  }
  for (const item of items) {
    if (!item.correctCount) continue;
    known.add(item.type === "kanji" ? kanjiData(item)?.w || item.value : item.value);
  }
  // Lo que el usuario ha dicho al leer manda sobre lo supuesto
  for (const word of userWords.values()) {
    if (KNOWN_STATUS.has(word.status)) known.add(word.lemma);
    else known.delete(word.lemma);
  }
  return known;
}

/* Una palabra escrita solo en kana (これ, する, コーヒー) no está en las listas
   por nivel: se da por conocida mientras el usuario no la marque al leer. */
function isKnownKey(key, known) {
  const mine = userWords.get(key);
  if (mine) return KNOWN_STATUS.has(mine.status);
  const lemma = key.split("|")[0];
  return known.has(lemma) || !/\p{Script=Han}/u.test(lemma);
}

function textCoverage(text, known = knownLemmas()) {
  if (!text.total) return 100;
  let covered = 0;
  for (const [key, count] of Object.entries(text.lemmas)) {
    if (isKnownKey(key, known)) covered += count;
  }
  return Math.round((covered / text.total) * 100);
}

function blankUserWord(lemma, reading) {
  const now = Date.now();
  return {
    id: wordKey(lemma, reading), lemma: normalizeText(lemma), reading: normalizeText(reading),
    status: "unknown",
    canReadKanji: false, knowsMeaning: false, canWrite: false,
    seen: 0, lookups: 0, evalCorrect: 0, evalWrong: 0,
    firstSeen: now, lastSeen: now, updatedAt: now
  };
}

async function saveUserWord(word) {
  word.updatedAt = Date.now();
  userWords.set(word.id, word);
  await putRecords("userWords", [word]);
  scheduleSync();
}

/* =========================================
   7. EVALUACIÓN INICIAL DE NIVEL
   ========================================= */

let placement = null;

function renderOnboarding() {
  $("readArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">読</div>
      <h3>${t("Antes de leer, veamos tu nivel")}</h3>
      <p>${t("Elige el nivel que crees tener y responde {n} preguntas rápidas. Con eso sabremos qué palabras dar por conocidas y qué textos proponerte.", { n: PLACEMENT_SIZE })}</p>
      <div class="inline-form placement-start">
        <select id="placementLevel" aria-label="${t("Nivel JLPT")}">
          ${LEVELS.map((level) => `<option>${level}</option>`).join("")}
        </select>
        <button id="placementStartBtn" class="button button-primary" type="button">
          ${t("Empezar evaluación")}
        </button>
      </div>
    </div>`;
  $("placementStartBtn").onclick = () => startPlacement($("placementLevel").value);
}

function startPlacement(level) {
  const index = LEVELS.indexOf(level);
  const pool = (lv) => shuffle([...levelVocabulary(lv).values()]
    .filter((word) => word && /\p{Script=Han}/u.test(word.lemma)));
  const own = pool(level);
  const easier = index > 0 ? pool(LEVELS[index - 1]) : [];
  const fromEasier = easier.length ? Math.round(PLACEMENT_SIZE * 0.4) : 0;

  const questions = [
    ...own.slice(0, PLACEMENT_SIZE - fromEasier).map((word) => ({ word, group: "own", pool: own })),
    ...easier.slice(0, fromEasier).map((word) => ({ word, group: "easier", pool: easier }))
  ];
  placement = { level, questions: shuffle(questions), index: 0, results: [] };
  renderPlacement();
}

const wordGloss = (word) => (lang === "es" && word.es.length ? word.es : word.en).slice(0, 2).join(", ");

function renderPlacement() {
  const { questions, index } = placement;
  const question = questions[index];
  const wrong = shuffle(question.pool.filter((other) =>
    other.reading !== question.word.reading && wordGloss(other) !== wordGloss(question.word))).slice(0, 3);
  const options = shuffle([question.word, ...wrong]);

  $("readArea").innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${t("Evaluación de nivel")}</span>
        <span class="card-progress">${index + 1} / ${questions.length}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <div style="width:${(index / questions.length) * 100}%"></div>
      </div>
      <div class="card-symbol word" lang="ja">${escapeHTML(question.word.lemma)}</div>
      <p class="helper">${t("¿Cómo se lee y qué significa?")}</p>
      <div class="choices">
        ${options.map((option, i) => `
          <button class="button button-outline choice" type="button" data-choice="${i}">
            <span lang="ja">${escapeHTML(option.reading)}</span> · ${escapeHTML(wordGloss(option))}
          </button>`).join("")}
        <button class="button button-quiet choice" type="button" data-choice="-1">${t("No la conozco")}</button>
      </div>
    </div>`;

  $("readArea").querySelectorAll("[data-choice]").forEach((button) => {
    button.onclick = () => {
      const picked = options[Number(button.dataset.choice)];
      const correct = picked === question.word;
      $("readArea").querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (options[Number(b.dataset.choice)] === question.word) b.classList.add("choice-right");
      });
      if (!correct) button.classList.add("choice-wrong");
      placement.results.push({ ...question, correct });
      setTimeout(() => {
        if (!placement) return;
        placement.index++;
        if (placement.index < questions.length) renderPlacement();
        else finishPlacement();
      }, correct ? 450 : 1100);
    };
  });
}

async function finishPlacement() {
  const { level, results } = placement;
  const rate = (group) => {
    const answers = results.filter((r) => r.group === group);
    return answers.length ? answers.filter((r) => r.correct).length / answers.length : null;
  };
  const index = LEVELS.indexOf(level);
  const own = rate("own"), easier = rate("easier");

  // Aprueba su nivel: se da por conocido. Si no, se baja un escalón.
  let assumed, readLevel = level;
  if (own >= PLACEMENT_PASS) assumed = level;
  else {
    readLevel = LEVELS[Math.max(0, index - 1)];
    assumed = easier !== null && easier >= PLACEMENT_PASS ? LEVELS[index - 1] : LEVELS[index - 2] || "";
  }
  meta.reading = { level: readLevel, assumed, placedAt: Date.now(), updatedAt: Date.now() };
  await saveMeta();
  scheduleSync();

  // Lo respondido cuenta ya como progreso de cada palabra
  const fresh = [];
  for (const { word, correct } of results) {
    const mine = blankUserWord(word.lemma, word.reading);
    Object.assign(mine, correct
      ? { status: "mastered", canReadKanji: true, knowsMeaning: true, evalCorrect: 1 }
      : { status: "learning", evalWrong: 1 });
    userWords.set(mine.id, mine);
    if (!words.has(mine.id)) {
      const entry = { id: mine.id, lemma: mine.lemma, reading: mine.reading, meanings: word.en,
        meaningsEs: word.es, pos: "", source: "jmdict", updatedAt: Date.now() };
      words.set(entry.id, entry);
      fresh.push(entry);
    }
  }
  await putRecords("userWords", results.map(({ word }) => userWords.get(wordKey(word.lemma, word.reading))));
  await putRecords("words", fresh);
  await addLearningToReview();

  const right = results.filter((r) => r.correct).length;
  placement = null;
  $("readArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>${t("Tu nivel de lectura: {level}", { level: readLevel })}</h3>
      <p>${t("Acertaste {right} de {total}.", { right, total: results.length })} ${
        assumed
          ? t("Daremos por conocido el vocabulario hasta {level}; los textos irán afinándolo.", { level: assumed })
          : t("Empezaremos desde lo más básico; los textos irán marcando lo que ya sabes.")}</p>
      <button id="placementDoneBtn" class="button button-primary" type="button">${t("Empezar a leer")}</button>
    </div>`;
  $("placementDoneBtn").onclick = renderRead;
  $("readLevel").textContent = readLevel;
}

/* =========================================
   8. ELEGIR O CREAR UN TEXTO
   ========================================= */

const TEXT_TYPES = [
  ["short story", "Historia corta"], ["dialogue", "Diálogo"], ["diary entry", "Diario"],
  ["message or email", "Mensaje o correo"], ["description", "Descripción"],
  ["simple news article", "Noticia sencilla"]
];
const TEXT_TOPICS = [
  ["daily life", "Vida diaria"], ["food", "Comida"], ["travel", "Viajes"], ["work", "Trabajo"],
  ["school", "Escuela"], ["family", "Familia"], ["shopping", "Compras"], ["free time", "Tiempo libre"]
];
const TEXT_LENGTHS = [[50, "Corto (unas 50 palabras)"], [100, "Medio (unas 100 palabras)"], [150, "Largo (unas 150 palabras)"]];
const PROMPT_WORD_LIMIT = 1500;

const MAX_SKIPS = 3; // textos que se pueden saltar seguidos antes de tener que terminar uno

/* Texto que el usuario tiene a medias: uno suyo sin leer. Mientras exista no
   puede crear otro; así nunca hay más de un texto incompleto. */
const pendingOwnText = () => texts.find((text) =>
  isOwnText(text) && !text.readAt && !text.discardedAt && !text.hiddenAt);

/* Saltos seguidos: textos descartados desde la última lectura terminada */
async function skipsUsed() {
  const sessions = (await getAll("sessions")).sort((a, b) => b.finishedAt - a.finishedAt);
  let used = 0;
  while (used < sessions.length && sessions[used].discarded) used++;
  return used;
}

/* Saltar un texto: se quita de la biblioteca del usuario y cuenta como salto */
async function skipText(text, clicks = new Map(), startedAt = Date.now()) {
  const record = {
    id: newId(), textId: text.id, startedAt, finishedAt: Date.now(), discarded: true,
    clicks: Object.fromEntries(clicks)
  };
  await putRecords("sessions", [record]);
  await deleteText(text.id);
  return record;
}

/* Texto sin leer con suficientes palabras conocidas; primero el más fácil */
function nextText() {
  const known = knownLemmas();
  return texts
    .filter((text) => !text.readAt && !text.discardedAt && !text.hiddenAt)
    .map((text) => ({ text, coverage: textCoverage(text, known) }))
    .filter((entry) => entry.coverage >= COVERAGE_TARGET)
    .sort((a, b) => b.coverage - a.coverage || a.text.createdAt - b.text.createdAt)[0];
}

/* Datos del usuario que necesita el prompt. Con niveles altos la lista entera
   no cabe: se manda el nivel dado por conocido y solo lo confirmado por el usuario. */
function promptParams({ type, topic, length }) {
  const all = [...knownLemmas()];
  const params = {
    level: meta.reading.level, type, topic, length,
    known: all, assumedLevels: [],
    learning: [...userWords.values()].filter((w) => w.status === "learning").map((w) => w.lemma).slice(0, 60)
  };
  if (all.length > PROMPT_WORD_LIMIT) {
    const confirmed = new Set();
    for (const item of items) if (item.correctCount) confirmed.add(kanjiData(item)?.w || item.value);
    for (const w of userWords.values()) if (KNOWN_STATUS.has(w.status)) confirmed.add(w.lemma);
    params.known = [...confirmed].slice(0, PROMPT_WORD_LIMIT);
    params.assumedLevels = assumedLevels();
  }
  return params;
}

/* El prompt en sí. IMPORTANTE: supabase/functions/generate-text/index.ts lleva
   una copia de esta función (allí se genera el texto con la IA); si cambias
   una, cambia la otra. No usa nada de fuera salvo TOKEN_POS. */
function renderPrompt({ level, type, topic, length, known, assumedLevels, learning }) {
  const fresh = Math.round(length * 0.1);
  const knownLine = assumedLevels.length
    ? `Known words: all standard JLPT ${assumedLevels.join(", ")} vocabulary` +
      (known.length ? `, plus: ${known.join("、")}` : ".")
    : known.length
      ? `Known words (the learner can read these): ${known.join("、")}`
      : "Known words: none yet. Use only the most basic beginner vocabulary.";

  return `You are writing a graded Japanese reading text for a learner.

LEARNER
- Target level: JLPT ${level}.
- ${knownLine}
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}
TEXT
- Type: ${type}. Topic: ${topic}.
- Length: about ${length} words (count the tokens that are not punctuation), in natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- Split it into short paragraphs (in a dialogue, one paragraph per speaker turn).
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use.

OUTPUT
Return ONLY one JSON object (no explanations, no markdown), with exactly this structure:

{
  "title": "毎朝のコーヒー",
  "title_en": "Morning coffee",
  "title_es": "El café de cada mañana",
  "topic": "${topic}",
  "level": "${level}",
  "sentences": [
    {
      "id": 1,
      "paragraph": 1,
      "jp": "私は毎朝コーヒーを飲みます。",
      "en": "I drink coffee every morning.",
      "es": "Bebo café todas las mañanas.",
      "tokens": [
        { "surface": "私", "lemma": "私", "reading": "わたし", "pos": "pronoun" },
        { "surface": "は", "lemma": "は", "reading": "は", "pos": "particle" },
        { "surface": "毎朝", "lemma": "毎朝", "reading": "まいあさ", "pos": "noun" },
        { "surface": "コーヒー", "lemma": "コーヒー", "reading": "コーヒー", "pos": "noun" },
        { "surface": "を", "lemma": "を", "reading": "を", "pos": "particle" },
        { "surface": "飲みます", "lemma": "飲む", "reading": "のみます", "pos": "verb" },
        { "surface": "。", "lemma": "。", "reading": "。", "pos": "punctuation" }
      ],
      "dictionary": {
        "私": { "reading": "わたし", "meanings": ["I", "me"], "meanings_es": ["yo"], "pos": "pronoun" },
        "毎朝": { "reading": "まいあさ", "meanings": ["every morning"], "meanings_es": ["todas las mañanas"], "pos": "noun" },
        "コーヒー": { "reading": "コーヒー", "meanings": ["coffee"], "meanings_es": ["café"], "pos": "noun" },
        "飲む": { "reading": "のむ", "meanings": ["to drink"], "meanings_es": ["beber"], "pos": "godan verb" }
      }
    }
  ]
}

RULES
1. "tokens" splits the sentence into words. Joining every "surface" in order must reproduce "jp" exactly, punctuation included.
2. Keep a conjugated verb or adjective together with its endings as ONE token (飲みます, 食べました, 高くない).
3. "surface" is the word as written; "lemma" is its dictionary form (飲みます → 飲む); the token "reading" is the reading of the surface as written, in hiragana (katakana words stay in katakana).
4. Token "pos" must be one of: ${TOKEN_POS.join(", ")}.
5. "dictionary" has one entry, keyed by lemma, for every token of the sentence except particle, auxiliary, punctuation, symbol, number and proper_noun. Each entry has "reading" (of the lemma, in kana), "meanings" (1-3, English), "meanings_es" (1-3, Spanish) and "pos" (free text).
6. "en" and "es" are natural translations of the sentence. "title_en" and "title_es" translate the title.
7. Sentence ids start at 1 and increase by 1. "paragraph" is the number of the paragraph the sentence belongs to, starting at 1.`;
}

const buildPrompt = (options) => renderPrompt(promptParams(options));

async function renderReadHome() {
  const skips = await skipsUsed();
  if (reader || placement || evaluation || document.body.dataset.view !== "read") return;

  // Primero el texto que tiene a medias; si no hay, uno de la comunidad a su nivel
  const own = pendingOwnText();
  const candidate = own ? { text: own, coverage: textCoverage(own) } : nextText();
  const canSkip = skips < MAX_SKIPS;
  const optionsOf = (list) => list.map(([value, label]) =>
    `<option value="${escapeHTML(String(value))}">${t(label)}</option>`).join("");

  $("readArea").innerHTML = `
    ${candidate ? `
    <div class="panel read-next">
      <div>
        <p class="eyebrow">${own ? t("TU TEXTO PENDIENTE") : t("TEXTO RECOMENDADO")}</p>
        <h3 lang="ja">${escapeHTML(candidate.text.title)}</h3>
        <p class="helper">${escapeHTML(lang === "es" ? candidate.text.titleEs : candidate.text.titleEn)} ·
          ${escapeHTML(candidate.text.level)} · ${t("{percent} % conocido", { percent: candidate.coverage })}</p>
      </div>
      <div class="import-actions">
        ${canSkip ? `<button id="readSkipBtn" class="button button-quiet" type="button">${t("Saltar: es muy difícil")}</button>` : ""}
        <button id="readNextBtn" class="button button-primary" type="button">${t("Leer ahora")} →</button>
      </div>
    </div>
    <p class="helper read-rule">${canSkip
      ? t("Termina este texto para crear otro. Si es demasiado difícil puedes saltarlo (te quedan {n}).", { n: plural(MAX_SKIPS - skips, "salto", "saltos") })
      : t("Ya saltaste {n} textos seguidos: termina este para poder crear otro.", { n: MAX_SKIPS })}</p>` : `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">読</div>
      <h3>${t("No hay textos sin leer a tu nivel")}</h3>
      <p>${t("Crea uno nuevo aquí abajo: elige tipo, tema y longitud, y la IA lo escribe para ti.")}</p>
    </div>`}

    ${candidate ? "" : `
    <div class="panel">
      <h3>${t("Crear un texto nuevo")}</h3>
      <div class="form-grid prompt-grid">
        <label class="field"><span>${t("Tipo de texto")}</span>
          <select id="promptType">${optionsOf(TEXT_TYPES)}</select></label>
        <label class="field"><span>${t("Tema")}</span>
          <select id="promptTopic">${optionsOf(TEXT_TOPICS)}
            <option value="">${t("Otro (escríbelo)")}</option></select></label>
        <label class="field"><span>${t("Longitud")}</span>
          <select id="promptLength">${optionsOf(TEXT_LENGTHS)}</select></label>
      </div>
      <label id="promptCustomField" class="field hidden"><span>${t("Tu tema")}</span>
        <input id="promptCustom" class="search" type="text" maxlength="80" autocomplete="off"></label>
      <div class="form-footer">
        <p class="helper">${t("La IA escribe un texto a tu medida con las palabras que ya conoces. Tarda alrededor de un minuto.")}</p>
        <div class="import-actions">
          <button id="promptBuildBtn" class="button button-quiet" type="button">${t("Modo manual")}</button>
          <button id="generateBtn" class="button button-primary" type="button">✦ ${t("Generar con IA")}</button>
        </div>
      </div>

      <div id="promptStep" class="hidden">
        <p class="helper">${t("1. Copia el prompt. 2. Pégalo en tu IA (ChatGPT, Claude, Gemini…). 3. Pega aquí su respuesta.")}</p>
        <label class="field"><span>${t("Prompt para la IA")}</span>
          <textarea id="promptOutput" rows="6" readonly spellcheck="false"></textarea></label>
        <div class="inline-form">
          <button id="promptCopyBtn" class="button button-outline" type="button">${t("Copiar prompt")}</button>
          <span id="promptCopied" class="helper"></span>
        </div>
        <label class="field"><span>${t("Respuesta de la IA (JSON)")}</span>
          <textarea id="promptAnswer" rows="6" spellcheck="false"></textarea></label>
        <div class="form-footer">
          <span></span>
          <button id="promptOpenBtn" class="button button-primary" type="button">${t("Validar y leer")}</button>
        </div>
      </div>
      <div id="promptMessage" class="message" role="status"></div>
    </div>`}`;

  if (candidate) {
    $("readNextBtn").onclick = () => openText(candidate.text.id);
    if (canSkip) $("readSkipBtn").onclick = async () => {
      await skipText(candidate.text);
      renderRead();
    };
    return; // con un texto pendiente no se muestra el formulario para crear otro
  }

  $("promptLength").value = meta.reading.level === "N5" ? "50" : "100";
  $("promptTopic").onchange = () =>
    $("promptCustomField").classList.toggle("hidden", $("promptTopic").value !== "");

  /* Lo elegido en el formulario, o null (con aviso) si falta el tema */
  const chosen = () => {
    const topic = $("promptTopic").value || $("promptCustom").value.trim();
    $("promptMessage").className = "message";
    $("promptMessage").textContent = topic ? "" : t("Escribe un tema primero.");
    return topic ? { type: $("promptType").value, topic, length: Number($("promptLength").value) } : null;
  };

  $("promptBuildBtn").onclick = () => {
    const options = chosen();
    if (!options) return;
    $("promptOutput").value = buildPrompt(options);
    $("promptStep").classList.remove("hidden");
    $("promptCopied").textContent = "";
  };

  $("generateBtn").onclick = () => {
    const options = chosen();
    if (options) generateAndOpen(options);
  };

  $("promptCopyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("promptOutput").value);
    } catch {
      $("promptOutput").select(); // sin permiso de portapapeles: queda seleccionado para copiar a mano
      document.execCommand?.("copy");
    }
    $("promptCopied").textContent = t("Copiado.");
  };

  $("promptOpenBtn").onclick = async () => {
    const message = $("promptMessage");
    const raw = $("promptAnswer").value;
    if (!raw.trim()) {
      message.className = "message";
      message.textContent = t("Pega primero el JSON del texto.");
      return;
    }
    const { errors, text } = validateText(raw);
    try {
      if (errors.length) throw errors;
      openText((await saveText(text)).id);
    } catch (error) {
      showTextErrors([].concat(error.message || error), message);
    }
  };
}

/* ---------- Generar el texto con la IA (función generate-text de Supabase) ---------- */

/* Mensaje claro para cada fallo de la función */
function generationMessage(code, limit) {
  const messages = {
    unauthorized: t("Inicia sesión para generar textos con IA."),
    limit: t("Has llegado al límite de hoy ({n} generaciones). Mañana podrás crear más, o usa el modo manual.", { n: limit }),
    quota: t("La IA ha agotado su cuota por ahora. Inténtalo más tarde o usa el modo manual."),
    truncated: t("El texto salió demasiado largo y se cortó. Prueba con una longitud menor."),
    not_configured: t("La generación con IA aún no está configurada. Usa el modo manual.")
  };
  return messages[code] || t("La IA no pudo escribir el texto. Inténtalo de nuevo o usa el modo manual.");
}

async function requestText(params, fix) {
  const { data, error } = await sb.functions.invoke("generate-text", { body: fix ? { ...params, fix } : params });
  if (!error) return data;
  // Sin red, o la función no está desplegada todavía
  if (!error.context?.json) throw new Error(navigator.onLine ? generationMessage("not_configured") : t("No hay conexión. Inténtalo de nuevo cuando tengas internet."));
  const info = await error.context.json().catch(() => ({}));
  throw new Error(generationMessage(error.context.status === 404 ? "not_configured" : info.error, info.limit));
}

async function generateAndOpen(options) {
  const message = $("promptMessage");
  if (!sb || !sync.user) {
    message.className = "message";
    message.textContent = generationMessage("unauthorized");
    if (sb) openAuth("login");
    return;
  }

  const button = $("generateBtn");
  const say = (text) => { if (message.isConnected) { message.className = "message"; message.textContent = text; } };
  button.disabled = true;
  say(t("La IA está escribiendo tu texto… puede tardar un minuto."));

  try {
    const params = promptParams(options);
    let answer = await requestText(params);
    let result = validateText(answer.text);
    if (result.errors.length) {
      // Un segundo intento: se le devuelven a la IA los errores del validador
      say(t("Revisando el formato del texto…"));
      answer = await requestText(params, { previous: answer.text, errors: result.errors.slice(0, 12) });
      result = validateText(answer.text);
    }
    if (result.errors.length) {
      throw [t("La IA no devolvió un texto válido. Inténtalo de nuevo."), ...result.errors];
    }
    openText((await saveText(result.text, "api")).id);
  } catch (error) {
    if (!message.isConnected) return;
    if (Array.isArray(error)) showTextErrors(error, message); // errores del validador
    else {
      message.className = "message incorrect";
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
}

/* =========================================
   9. LECTOR
   ========================================= */

let reader = null; // { text, dictionary, canSkip, clicks: Map(clave -> clasificación), startedAt }

const CLASSES = {
  new: "Nueva", kanji: "Conocía la palabra, no el kanji", check: "La conocía, solo comprobaba"
};

async function openText(id) {
  const text = texts.find((x) => x.id === id);
  if (!text) return;
  const canSkip = !text.readAt && await skipsUsed() < MAX_SKIPS; // un texto ya leído no se salta
  const dictionary = {};
  for (const sentence of text.data.sentences) Object.assign(dictionary, sentence.dictionary);
  reader = { text, dictionary, canSkip, clicks: new Map(), startedAt: Date.now() };
  switchView("read");
}

const tokenKey = (token) => reader.dictionary[token.lemma]
  ? wordKey(token.lemma, reader.dictionary[token.lemma].reading) : "";

/* Furigana solo sobre la parte en kanji: 飲みます -> 飲(の)みます */
function rubyHTML(surface, reading) {
  const s = [...surface], r = [...reading];
  const same = (a, b) => !isKanji(a) && normalizeReading(a) === normalizeReading(b);
  let end = 0;
  while (end < s.length && end < r.length && same(s[s.length - 1 - end], r[r.length - 1 - end])) end++;
  let start = 0;
  while (start < s.length - end && start < r.length - end && same(s[start], r[start])) start++;
  const base = s.slice(start, s.length - end).join("");
  const top = r.slice(start, r.length - end).join("");
  if (!base || !top) return escapeHTML(surface);
  return `${escapeHTML(s.slice(0, start).join(""))}<ruby>${escapeHTML(base)}<rt>${escapeHTML(top)}</rt></ruby>${
    escapeHTML(s.slice(s.length - end).join(""))}`;
}

function sentenceHTML(sentence, index, known) {
  const mode = prefs.furigana;
  return sentence.tokens.map((token, tokenIndex) => {
    const key = tokenKey(token);
    if (!key) return escapeHTML(token.surface);

    const hasKanji = /\p{Script=Han}/u.test(token.surface);
    const unknown = !UNCOUNTED_POS.has(token.pos) && !isKnownKey(key, known);
    const furigana = hasKanji && (mode === "all" || mode === "unknown" && unknown);
    const mark = reader.clicks.get(key);
    return `<span class="tok${mark ? ` tok-${mark}` : ""}" role="button" tabindex="0"
      data-s="${index}" data-t="${tokenIndex}">${
        furigana ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface)}</span>`;
  }).join("");
}

function renderReader() {
  const { text, canSkip } = reader;
  const known = knownLemmas();
  // Las oraciones seguidas del mismo párrafo se leen como texto corrido
  const paragraphs = [];
  text.data.sentences.forEach((sentence, index) => {
    const last = paragraphs[paragraphs.length - 1];
    if (last && (sentence.paragraph ?? 1) === (last[0][0].paragraph ?? 1)) last.push([sentence, index]);
    else paragraphs.push([[sentence, index]]);
  });
  $("readArea").innerHTML = `
    <div class="reader">
      <div class="reader-head">
        <div>
          <h3 lang="ja">${escapeHTML(text.title)}</h3>
          <p class="helper">${escapeHTML(lang === "es" ? text.titleEs : text.titleEn)} ·
            ${escapeHTML(text.level)} · ${escapeHTML(text.topic)}</p>
        </div>
        <button id="readerCloseBtn" class="button button-quiet" type="button">${t("Salir")}</button>
      </div>
      <p class="helper">${t("Toca cualquier palabra para ver su lectura, su significado y la traducción de la frase.")}</p>
      <div class="reading-text" lang="ja">
        ${paragraphs.map((group) => `
        <p>${group.map(([sentence, index]) =>
          `<span class="sent" data-sent="${index}">${sentenceHTML(sentence, index, known)}</span>`).join("")}</p>`).join("")}
      </div>
      <div class="row-actions">
        ${canSkip ? `<button id="readerDiscardBtn" class="button button-outline" type="button">${t("Saltar: es muy difícil")}</button>` : ""}
        <button id="readerFinishBtn" class="button button-primary" type="button">${t("Terminar lectura")}</button>
      </div>
    </div>`;

  $("readerCloseBtn").onclick = () => { closeWordPop(); reader = null; renderRead(); };
  $("readerFinishBtn").onclick = () => finishReading(false);
  if (canSkip) $("readerDiscardBtn").onclick = () => finishReading(true);
}

/* ---------- Popup de palabra ---------- */

function closeWordPop() {
  $("wordPop").classList.add("hidden");
  document.querySelectorAll(".tok.active, .sent.active").forEach((el) => el.classList.remove("active"));
}

function openWordPop(element) {
  const sentence = reader.text.data.sentences[Number(element.dataset.s)];
  const token = sentence.tokens[Number(element.dataset.t)];
  const entry = reader.dictionary[token.lemma];
  const key = tokenKey(token);
  if (!reader.clicks.has(key)) reader.clicks.set(key, "looked");

  const meanings = lang === "es" && entry.meanings_es?.length ? entry.meanings_es : entry.meanings;
  const current = reader.clicks.get(key);
  const pop = $("wordPop");
  pop.innerHTML = `
    <button id="wordPopClose" class="icon-btn pop-close" type="button"
      title="${t("Cerrar")}" aria-label="${t("Cerrar")}">×</button>
    <div class="pop-word" lang="ja">${escapeHTML(token.surface)}</div>
    <div class="pop-reading" lang="ja">${escapeHTML(token.reading)}</div>
    ${token.lemma !== token.surface ? `<p class="pop-lemma">${t("Forma de diccionario")}:
      <span lang="ja">${escapeHTML(token.lemma)}（${escapeHTML(entry.reading)}）</span></p>` : ""}
    <p class="meaning">${escapeHTML(meanings.join(", "))}</p>
    <p class="helper">${escapeHTML(entry.pos || token.pos || "")}</p>
    <div class="pop-example">
      <p lang="ja">${escapeHTML(sentence.jp)}</p>
      <p class="pop-translation">${escapeHTML(lang === "es" ? sentence.es : sentence.en)}</p>
    </div>
    <div class="pop-actions">
      ${Object.entries(CLASSES).map(([cls, label]) => `
        <button class="button pop-${cls}${current === cls ? " chosen" : ""}" type="button"
          data-class="${cls}">${t(label)}</button>`).join("")}
    </div>`;

  document.querySelectorAll(".tok.active, .sent.active").forEach((el) => el.classList.remove("active"));
  element.classList.add("active");
  element.closest(".sent").classList.add("active"); // en pantallas táctiles no hay hover
  pop.classList.remove("hidden");

  // En escritorio aparece bajo la palabra; en móvil el CSS lo fija abajo
  const rect = element.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 24);
  pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + window.scrollX}px`;

  $("wordPopClose").onclick = closeWordPop;
  pop.querySelectorAll("[data-class]").forEach((button) => {
    button.onclick = () => classifyWord(key, token.lemma, entry.reading, button.dataset.class);
  });
}

/* New: no la conocía. Kanji: conocía la palabra pero no su escritura.
   Check: la conocía; queda como posiblemente conocida hasta la evaluación. */
async function classifyWord(key, lemma, reading, cls) {
  const mine = userWords.get(key) || blankUserWord(lemma, reading);
  if (reader.clicks.get(key) === "looked" || !reader.clicks.has(key)) mine.lookups++;
  mine.lastSeen = Date.now();

  if (cls === "new") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: false });
  if (cls === "kanji") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: true });
  if (cls === "check" && mine.status !== "mastered") mine.status = "pre_known";

  reader.clicks.set(key, cls);
  await saveUserWord(mine);
  await addLearningToReview();
  closeWordPop();
  const scroll = window.scrollY;
  renderReader();
  window.scrollTo(0, scroll);
}

/* ---------- Fin de la lectura ---------- */

async function finishReading(discarded) {
  closeWordPop();
  const { text, clicks, startedAt } = reader;
  const now = Date.now();

  let record;
  if (discarded) {
    record = await skipText(text, clicks, startedAt);
  } else {
    text.readAt = text.updatedAt = now;
    await putRecords("texts", [text]);
    record = { id: newId(), textId: text.id, startedAt, finishedAt: now, discarded, clicks: Object.fromEntries(clicks) };
    await putRecords("sessions", [record]);
  }

  const marked = [...clicks.values()].filter((cls) => cls === "new" || cls === "kanji").length;
  const unique = Object.keys(text.lemmas).length || 1;
  const summary = {
    discarded, record,
    looked: clicks.size,
    hard: discarded || marked / unique >= HARD_RATIO,
    easier: LEVELS[LEVELS.indexOf(meta.reading.level) - 1]
  };

  // Un texto descartado no se leyó: sus palabras no cambian de estado
  const candidates = discarded ? [] : await markSeenWords(text, clicks);
  reader = null;
  scheduleSync();
  if (candidates.length) startEvaluation(candidates, summary);
  else renderReadSummary(summary);
}

/* Al terminar un texto, sus palabras sin progreso pasan a pre_known
   (posiblemente conocidas, sin confirmar). Devuelve las pre_known vistas,
   primero las que el usuario consultó. */
async function markSeenWords(text, clicks) {
  const now = Date.now();
  const seen = [];
  for (const key of Object.keys(text.lemmas)) {
    const entry = words.get(key);
    if (!entry) continue;
    let mine = userWords.get(key);
    if (!mine) {
      mine = blankUserWord(entry.lemma, entry.reading);
      mine.status = "pre_known";
    }
    mine.seen++;
    mine.lastSeen = mine.updatedAt = now;
    userWords.set(key, mine);
    seen.push(mine);
  }
  await putRecords("userWords", seen);

  const hasKanji = (word) => /\p{Script=Han}/u.test(word.lemma);
  return shuffle(seen.filter((word) => word.status === "pre_known"))
    .sort((a, b) => clicks.has(b.id) - clicks.has(a.id) || hasKanji(b) - hasKanji(a));
}

function renderReadSummary({ discarded, looked, hard, easier, mastered, learning }) {
  $("readArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${discarded ? "…" : "✓"}</div>
      <h3>${discarded ? t("Texto saltado") : t("Lectura terminada")}</h3>
      <p>${t("Consultaste {n} de este texto.", { n: plural(looked, "palabra", "palabras") })}
        ${mastered === undefined ? "" : t("En la evaluación: {mastered} y {learning}.", {
          mastered: plural(mastered, "palabra dominada", "palabras dominadas"),
          learning: plural(learning, "por aprender", "por aprender") })}
        ${hard && easier ? t("Parece que este nivel te queda difícil. ¿Quieres textos de {level}?", { level: easier }) : ""}</p>
      <div class="row-actions">
        ${hard && easier ? `<button id="readEasierBtn" class="button button-outline" type="button">
          ${t("Cambiar a {level}", { level: easier })}</button>` : ""}
        <button id="readMoreBtn" class="button button-primary" type="button">${t("Siguiente texto")}</button>
      </div>
    </div>`;
  $("readMoreBtn").onclick = renderRead;
  if ($("readEasierBtn")) $("readEasierBtn").onclick = async () => {
    await setReadLevel(easier);
    renderRead();
  };
}

/* =========================================
   10. EVALUACIÓN TRAS LA LECTURA
   -----------------------------------------
   De cada palabra pre_known se pregunta la lectura y el significado.
   Las dos bien -> mastered; algún fallo -> learning.
   ========================================= */

const EVAL_SIZE = 8; // palabras por evaluación; el resto sigue en pre_known

let evaluation = null; // { queue: [{ word, entry, steps }], index, step, results, summary }

function startEvaluation(candidates, summary) {
  const queue = candidates.slice(0, EVAL_SIZE).map((word) => ({
    word,
    entry: words.get(word.id),
    // Una palabra en kana ya se sabe leer: solo se pregunta el significado
    steps: /\p{Script=Han}/u.test(word.lemma) ? ["reading", "meaning"] : ["meaning"]
  }));
  evaluation = { queue, index: 0, step: 0, results: new Map(), summary };
  renderEvaluationIntro();
}

function renderEvaluationIntro() {
  $("readArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">試</div>
      <h3>${t("Lectura terminada. ¿Las conocías de verdad?")}</h3>
      <p>${t("Hay {n} sin confirmar. Una evaluación rápida comprueba cuáles dominas ya.", {
        n: plural(evaluation.queue.length, "palabra", "palabras") })}</p>
      <div class="row-actions">
        <button id="evalSkipBtn" class="button button-quiet" type="button">${t("Ahora no")}</button>
        <button id="evalStartBtn" class="button button-primary" type="button">${t("Empezar evaluación")}</button>
      </div>
    </div>`;
  $("evalStartBtn").onclick = () => { evaluation.started = true; renderEvaluation(); };
  $("evalSkipBtn").onclick = () => {
    const { summary } = evaluation;
    evaluation = null;
    renderReadSummary(summary);
  };
}

const entryGloss = (entry) =>
  (lang === "es" && entry.meaningsEs?.length ? entry.meaningsEs : entry.meanings).slice(0, 2).join(", ");

function renderEvaluation() {
  if (!evaluation.started) return renderEvaluationIntro();
  const { queue, index, step } = evaluation;
  const { word, entry, steps } = queue[index];
  const kind = steps[step];
  const label = kind === "reading" ? (e) => e.reading : entryGloss;

  // Respuestas falsas: otras palabras del diccionario con respuesta distinta
  const seenLabels = new Set([label(entry)]);
  const wrong = [];
  for (const other of shuffle([...words.values()])) {
    if (wrong.length === 3) break;
    if (kind === "reading" && !/\p{Script=Han}/u.test(other.lemma)) continue;
    const text = label(other);
    if (!text || seenLabels.has(text)) continue;
    seenLabels.add(text);
    wrong.push(other);
  }
  const options = shuffle([entry, ...wrong]);

  $("readArea").innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${t("Evaluación")}</span>
        <span class="card-progress">${index + 1} / ${queue.length}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <div style="width:${(index / queue.length) * 100}%"></div>
      </div>
      <div class="card-symbol word" lang="ja">${escapeHTML(word.lemma)}</div>
      <p class="helper">${kind === "reading" ? t("¿Cómo se lee?") : t("¿Qué significa?")}</p>
      <div class="choices">
        ${options.map((option, i) => `
          <button class="button button-outline choice" type="button" data-choice="${i}"
            ${kind === "reading" ? 'lang="ja"' : ""}>${escapeHTML(label(option))}</button>`).join("")}
        <button class="button button-quiet choice" type="button" data-choice="-1">${t("No lo sé")}</button>
      </div>
    </div>`;

  const current = evaluation;
  $("readArea").querySelectorAll("[data-choice]").forEach((button) => {
    button.onclick = () => {
      const correct = options[Number(button.dataset.choice)] === entry;
      $("readArea").querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (options[Number(b.dataset.choice)] === entry) b.classList.add("choice-right");
      });
      if (!correct) button.classList.add("choice-wrong");

      const result = current.results.get(word.id) || {};
      result[kind] = correct;
      current.results.set(word.id, result);

      setTimeout(() => {
        if (evaluation !== current) return;
        if (++current.step >= steps.length) { current.step = 0; current.index++; }
        if (current.index < queue.length) renderEvaluation();
        else finishEvaluation();
      }, correct ? 450 : 1100);
    };
  });
}

async function finishEvaluation() {
  const { queue, results, summary } = evaluation;
  let mastered = 0;

  for (const { word } of queue) {
    const result = results.get(word.id);
    const reading = result.reading ?? true; // en kana no se pregunta
    const passed = reading && result.meaning;
    Object.assign(word, {
      status: passed ? "mastered" : "learning",
      canReadKanji: reading,
      knowsMeaning: result.meaning
    });
    if (passed) { word.evalCorrect++; mastered++; } else word.evalWrong++;
    word.updatedAt = Date.now();
  }
  await putRecords("userWords", queue.map(({ word }) => word));

  summary.record.evaluation = Object.fromEntries(results);
  await putRecords("sessions", [summary.record]);
  await addLearningToReview();
  scheduleSync();

  evaluation = null;
  renderReadSummary({ ...summary, mastered, learning: queue.length - mastered });
}

async function setReadLevel(level) {
  meta.reading.level = level;
  meta.reading.updatedAt = Date.now();
  await saveMeta();
  scheduleSync();
  $("readLevel").textContent = level;
  $("readLevelSelect").value = level;
}

/* ---------- Vista ---------- */

function renderRead() {
  $("readLevel").textContent = meta.reading.level || "";
  $("readLevel").classList.toggle("hidden", !meta.reading.placedAt);
  if (meta.reading.level) $("readLevelSelect").value = meta.reading.level;
  if (placement) return renderPlacement();
  if (evaluation && meta.reading.placedAt) return renderEvaluation();
  if (!meta.reading.placedAt) return renderOnboarding();
  if (reader) return renderReader();
  renderReadHome();
}

function bindReader() {
  const area = $("readArea");
  area.addEventListener("click", (event) => {
    const token = event.target.closest(".tok");
    if (token) openWordPop(token);
  });
  area.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".tok")) {
      event.preventDefault();
      openWordPop(event.target);
    }
  });
  // Se cierra al tocar fuera o con Escape
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#wordPop, .tok")) closeWordPop();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWordPop();
  });

  // Ajustes de lectura
  $("furiganaSelect").value = prefs.furigana;
  $("furiganaSelect").addEventListener("change", () => {
    prefs.furigana = $("furiganaSelect").value;
    saveLocal("kanji-prefs", prefs);
  });
  $("readLevelSelect").value = meta.reading.level || "N5";
  $("readLevelSelect").addEventListener("change", () => setReadLevel($("readLevelSelect").value));
  $("placementRedoBtn").addEventListener("click", () => {
    reader = evaluation = null;
    meta.reading = {};
    switchView("read");
  });
}

/* =========================================
   11. ESTADÍSTICAS DE LECTURA
   ========================================= */

const WORD_STATUS = [
  ["mastered", "Dominadas", "sw-mature"],
  ["pre_known", "Por confirmar", "sw-prek"],
  ["learning", "Aprendiendo", "sw-learning"],
  ["unknown", "Desconocidas", "sw-new"]
];
const WORD_STATUS_ONE = {
  mastered: "Dominada", pre_known: "Por confirmar", learning: "Aprendiendo", unknown: "Desconocida"
};
const STAT_WEEKS = 8;
const WORD_PAGE = 150; // este archivo se carga antes que app.js: no puede usar sus constantes aquí
let wordLimit = WORD_PAGE;

const wordGlossOf = (id) => {
  const entry = words.get(id);
  return entry ? entryGloss(entry) : "";
};

/* Días seguidos con alguna lectura terminada (hoy puede completarse aún) */
function readingStreak(sessions) {
  const days = new Set(sessions.filter((s) => !s.discarded).map((s) => isoDate(new Date(s.finishedAt))));
  const d = new Date();
  if (!days.has(isoDate(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(isoDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

async function renderReadingStats() {
  const mine = [...userWords.values()];
  const sessions = await getAll("sessions");
  const count = (test) => mine.filter(test).length;

  $("statWords").textContent = mine.length;
  $("statWordsRead").textContent = count((w) => w.canReadKanji);
  $("statWordsMeaning").textContent = count((w) => w.knowsMeaning);
  $("statTexts").textContent = texts.filter((x) => x.readAt).length;
  $("statReadStreak").textContent = plural(readingStreak(sessions), "día", "días");

  // Palabras por estado
  const total = mine.length;
  $("wordStateBar").innerHTML = total ? `
    <div class="level-row">
      <div class="stack">
        ${WORD_STATUS.map(([status, label, cls]) => {
          const n = count((w) => w.status === status);
          if (!n) return "";
          const tip = t("{name}: {count} de {total}", { name: t(label), count: n, total });
          return `<div class="seg ${cls}" style="flex-grow:${n}" tabindex="0"
            data-tip="${tip}" aria-label="${tip}"></div>`;
        }).join("")}
      </div>
    </div>
    <div class="legend state-counts">
      ${WORD_STATUS.map(([status, label, cls]) =>
        `<span><i class="sw ${cls}"></i>${t(label)}: ${count((w) => w.status === status)}</span>`).join("")}
    </div>`
    : `<p class="helper">${t("Aquí verás tus palabras cuando termines tu primera lectura.")}</p>`;

  // Palabras nuevas por semana (semanas que empiezan en lunes)
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = Array.from({ length: STAT_WEEKS }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() - 7 * (STAT_WEEKS - 1 - i));
    return { start: start.getTime(), count: 0 };
  });
  for (const word of mine) {
    const week = weeks.findLast((w) => word.firstSeen >= w.start);
    if (week) week.count++;
  }
  const max = Math.max(1, ...weeks.map((w) => w.count));
  $("weekChart").innerHTML = weeks.map((week, i) => {
    const label = i === STAT_WEEKS - 1 ? t("Esta semana")
      : new Date(week.start).toLocaleDateString(lang, { day: "numeric", month: "short" });
    const tip = `${label}: ${plural(week.count, "palabra nueva", "palabras nuevas")}`;
    return `
    <div class="bar-col" tabindex="0" data-tip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}">
      <span class="bar-value">${week.count || ""}</span>
      <div class="bar" style="height:${(week.count / max) * 100}%"></div>
      <span class="bar-label">${i === STAT_WEEKS - 1 ? t("Hoy") : new Date(week.start).getDate()}</span>
    </div>`;
  }).join("");

  // Las que más cuestan
  const top = (field, one, many, empty) => {
    const list = mine.filter((w) => w[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, 8);
    return list.length ? list.map((word) => `
      <div class="hard-item">
        <span class="hard-symbol" lang="ja">${escapeHTML(word.lemma)}</span>
        <span class="hard-reading">${escapeHTML(word.reading)} · ${escapeHTML(wordGlossOf(word.id))}</span>
        <span class="hard-count">${plural(word[field], one, many)}</span>
      </div>`).join("")
      : `<p class="helper">${t(empty)}</p>`;
  };
  $("lookedList").innerHTML = top("lookups", "consulta", "consultas",
    "Aquí aparecerán las palabras que más consultes al leer.");
  $("failedList").innerHTML = top("evalWrong", "fallo", "fallos",
    "Aquí aparecerán las palabras que más falles en las evaluaciones.");

  renderWordList();
}

function renderWordList() {
  const status = $("wordStatus").value;
  const query = normalizeText($("wordSearch").value).toLowerCase();
  const kana = normalizeReading(query);

  const filtered = [...userWords.values()].filter((word) => {
    if (status && word.status !== status) return false;
    if (!query) return true;
    return word.lemma.includes(query) || normalizeReading(word.reading).includes(kana) ||
      wordGlossOf(word.id).toLowerCase().includes(query);
  }).sort((a, b) => b.lastSeen - a.lastSeen);

  $("wordMoreBtn").classList.toggle("hidden", filtered.length <= wordLimit);
  $("wordMoreBtn").textContent = t("Mostrar más ({n} restantes)", { n: filtered.length - wordLimit });

  if (!filtered.length) {
    $("wordList").innerHTML = `<div class="no-items">${userWords.size
      ? t("No se encontraron palabras.") : t("Todavía no hay palabras de tus lecturas.")}</div>`;
    return;
  }
  $("wordList").innerHTML = filtered.slice(0, wordLimit).map((word) => `
    <article class="item-row">
      <div class="item-symbol word-symbol" lang="ja">${escapeHTML(word.lemma)}</div>
      <div class="item-info">
        <div class="item-title" lang="ja">${escapeHTML(word.reading)}</div>
        <div class="item-sub">${escapeHTML(wordGlossOf(word.id))}</div>
      </div>
      <div class="item-state word-state">
        <span class="state-tag state-${word.status}">${t(WORD_STATUS_ONE[word.status] || "Desconocida")}</span>
        <span class="skills" title="${t("Sabe leerla · Sabe el significado")}">
          <i class="${word.canReadKanji ? "on" : ""}" lang="ja">読</i><i class="${word.knowsMeaning ? "on" : ""}" lang="ja">意</i>
        </span>
      </div>
    </article>`).join("");
}

function bindReadingStats() {
  const reset = () => { wordLimit = WORD_PAGE; renderWordList(); };
  $("wordStatus").addEventListener("change", reset);
  $("wordSearch").addEventListener("input", reset);
  $("wordMoreBtn").addEventListener("click", () => { wordLimit += WORD_PAGE; renderWordList(); });
}

/* =========================================
   12. SINCRONIZACIÓN DE LA LECTURA (Supabase)
   -----------------------------------------
   Mismo método que los elementos de repaso (app.js): se descargan las
   filas cambiadas desde la última vez y se sube lo que el servidor no tiene.
   - texts: los propios y los aprobados de otros usuarios. Un texto subido
     queda "pending" hasta que un administrador lo aprueba.
   - text_states: leído / descartado / oculto, por usuario.
   - user_words, reading_sessions, profiles: solo del usuario.
   El diccionario (words) no se sube: se reconstruye de los textos.
   ========================================= */

const isoOf = (ms) => ms ? new Date(ms).toISOString() : null;
const msOf = (iso) => iso ? Date.parse(iso) : null;
const isOwnText = (text) => !text.owner || text.owner === sync.config.userId;
const statePrint = (text) => `${text.readAt || 0}:${text.discardedAt || 0}:${text.hiddenAt || 0}`;
const profilePrint = (profile) => `${profile.level}|${profile.assumed}|${profile.placedAt}`;

/* Palabras de la evaluación inicial: su significado sale de las anclas */
const anchorWords = (() => {
  let index;
  return () => index ??= new Map(Object.values(KANJI_DATA).map((data) => [data.w, data]));
})();

function ensureWordEntry(mine) {
  if (words.has(mine.id)) return null;
  const data = anchorWords().get(mine.lemma);
  if (!data || normalizeReading(data.r) !== normalizeReading(mine.reading)) return null;
  const entry = { id: mine.id, lemma: mine.lemma, reading: mine.reading, meanings: data.en,
    meaningsEs: data.es, pos: "", source: "jmdict", updatedAt: Date.now() };
  words.set(entry.id, entry);
  return entry;
}

async function pullReading(userId) {
  const cursors = sync.config.cursors;
  const last = (rows, name) => { if (rows.length) cursors[name] = rows[rows.length - 1].updated_at; };
  let changed = false;

  // Perfil
  let rows = await fetchChanged("profiles", "user_id", userId, cursors.profiles);
  for (const row of rows) {
    if (!row.placed_at) continue;
    const remote = { level: row.reading_level, assumed: row.assumed_level || "",
      placedAt: msOf(row.placed_at), updatedAt: Number(row.client_updated_at) };
    sync.pushed.profile = profilePrint(remote);
    if (!meta.reading.placedAt || remote.updatedAt > (meta.reading.updatedAt || 0)) {
      meta.reading = remote;
      await saveMeta();
      changed = true;
    }
  }
  last(rows, "profiles");

  // Textos: los propios y los aprobados de los demás
  rows = await fetchChanged("texts", "id", userId, cursors.texts, false);
  const saved = [], removed = [], freshWords = [];
  for (const row of rows) {
    const mine = texts.find((x) => x.id === row.id);
    if (row.deleted_at) {
      sync.pushed.texts[row.id] = "d";
      if (mine) { removed.push(row.id); texts = texts.filter((x) => x !== mine); }
      continue;
    }
    sync.pushed.texts[row.id] = "1";
    if (deletedTexts.some((x) => x.id === row.id)) continue; // borrado aquí: se subirá el borrado
    const record = {
      ...(mine || { readAt: null }),
      id: row.id, owner: row.user_id,
      title: row.title, titleEn: row.title_en, titleEs: row.title_es,
      topic: row.topic, level: row.level, source: row.source, status: row.status,
      createdAt: msOf(row.created_at), updatedAt: msOf(row.updated_at),
      lemmas: row.lemmas, total: row.total, data: row.data
    };
    if (mine) texts[texts.indexOf(mine)] = record; else texts.push(record);
    if (mine && reader?.text === mine) reader.text = record;
    saved.push(record);
    freshWords.push(...wordsFromText(row.data));
  }
  if (saved.length || removed.length) {
    await putRecords("texts", saved, removed);
    await putRecords("words", freshWords);
    changed = true;
  }
  last(rows, "texts");

  // Estado de los textos para este usuario
  rows = await fetchChanged("text_states", "text_id", userId, cursors.text_states);
  const touched = [];
  for (const row of rows) {
    const text = texts.find((x) => x.id === row.text_id);
    if (!text) continue;
    const before = statePrint(text);
    text.readAt = Math.max(text.readAt || 0, msOf(row.read_at) || 0) || null;
    text.discardedAt = Math.max(text.discardedAt || 0, msOf(row.discarded_at) || 0) || null;
    text.hiddenAt = Math.max(text.hiddenAt || 0, msOf(row.hidden_at) || 0) || null;
    sync.pushed.states[text.id] = `${msOf(row.read_at) || 0}:${msOf(row.discarded_at) || 0}:${msOf(row.hidden_at) || 0}`;
    if (statePrint(text) !== before) touched.push(text);
  }
  if (touched.length) { await putRecords("texts", touched); changed = true; }
  last(rows, "text_states");

  // Progreso por palabra: gana la versión modificada más recientemente
  rows = await fetchChanged("user_words", "id", userId, cursors.user_words);
  const newer = [], entries = [];
  for (const row of rows) {
    const stamp = Number(row.client_updated_at);
    sync.pushed.words[row.id] = String(stamp);
    const mine = userWords.get(row.id);
    if (mine && mine.updatedAt >= stamp) continue;
    const record = {
      id: row.id, lemma: row.lemma, reading: row.reading, status: row.status,
      canReadKanji: row.can_read_kanji, knowsMeaning: row.knows_meaning, canWrite: row.can_write,
      seen: row.seen, lookups: row.lookups, evalCorrect: row.eval_correct, evalWrong: row.eval_wrong,
      firstSeen: msOf(row.first_seen), lastSeen: msOf(row.last_seen), updatedAt: stamp
    };
    userWords.set(record.id, record);
    newer.push(record);
    const entry = ensureWordEntry(record);
    if (entry) entries.push(entry);
  }
  if (newer.length) {
    await putRecords("userWords", newer);
    await putRecords("words", entries);
    changed = true;
  }
  last(rows, "user_words");

  // Sesiones
  rows = await fetchChanged("reading_sessions", "id", userId, cursors.reading_sessions);
  if (rows.length) {
    const local = new Map((await getAll("sessions")).map((s) => [s.id, s]));
    const fresh = [];
    for (const row of rows) {
      sync.pushed.sessions[row.id] = row.evaluation ? "e" : "s";
      const mine = local.get(row.id);
      if (mine && (mine.evaluation || !row.evaluation)) continue;
      fresh.push({
        id: row.id, textId: row.text_id, startedAt: msOf(row.started_at), finishedAt: msOf(row.finished_at),
        discarded: row.discarded, clicks: row.clicks || {},
        ...(row.evaluation ? { evaluation: row.evaluation } : {})
      });
    }
    if (fresh.length) { await putRecords("sessions", fresh); changed = true; }
  }
  last(rows, "reading_sessions");

  if (changed) {
    await addLearningToReview();
    refreshReadingViews();
  }
}

async function pushReading(userId) {
  const pushed = sync.pushed;

  // Perfil
  if (meta.reading.placedAt && pushed.profile !== profilePrint(meta.reading)) {
    const print = profilePrint(meta.reading);
    await pushRows("profiles", "user_id", [{
      user_id: userId, reading_level: meta.reading.level, assumed_level: meta.reading.assumed || null,
      placed_at: isoOf(meta.reading.placedAt), client_updated_at: Math.round(meta.reading.updatedAt || meta.reading.placedAt)
    }], [], {});
    pushed.profile = print;
  }

  // Textos propios aún no subidos: quedan pendientes de aprobación
  const mineToPush = texts.filter((text) => isOwnText(text) && !pushed.texts[text.id]);
  for (const text of mineToPush) {
    text.owner = userId;
    if (text.status !== "approved") text.status = "pending";
  }
  if (mineToPush.length) {
    await putRecords("texts", mineToPush);
    await pushRows("texts", "id", mineToPush.map((text) => ({
      id: text.id, user_id: userId,
      title: text.title, title_en: text.titleEn, title_es: text.titleEs,
      topic: text.topic, level: text.level, source: text.source || "manual",
      data: text.data, lemmas: text.lemmas, total: text.total,
      created_at: isoOf(text.createdAt), deleted_at: null
    })), mineToPush.map((text) => [text.id, "1"]), pushed.texts, { ignoreDuplicates: true });
  }
  // Textos propios borrados
  for (const gone of deletedTexts) {
    if (pushed.texts[gone.id] === "d") continue;
    if (pushed.texts[gone.id]) {
      const { error } = await sb.from("texts").update({ deleted_at: isoOf(gone.deletedAt) }).eq("id", gone.id);
      if (error) throw error;
    }
    pushed.texts[gone.id] = "d";
  }

  // Estado de los textos
  const states = texts.filter((text) =>
    (text.readAt || text.discardedAt || text.hiddenAt) && pushed.states[text.id] !== statePrint(text));
  await pushRows("text_states", "user_id,text_id", states.map((text) => ({
    user_id: userId, text_id: text.id,
    read_at: isoOf(text.readAt), discarded_at: isoOf(text.discardedAt), hidden_at: isoOf(text.hiddenAt)
  })), states.map((text) => [text.id, statePrint(text)]), pushed.states);

  // Progreso por palabra
  const changed = [...userWords.values()].filter((word) => pushed.words[word.id] !== String(word.updatedAt));
  await pushRows("user_words", "user_id,id", changed.map((word) => ({
    user_id: userId, id: word.id, lemma: word.lemma, reading: word.reading, status: word.status,
    can_read_kanji: !!word.canReadKanji, knows_meaning: !!word.knowsMeaning, can_write: !!word.canWrite,
    seen: whole(word.seen), lookups: whole(word.lookups),
    eval_correct: whole(word.evalCorrect), eval_wrong: whole(word.evalWrong),
    first_seen: isoOf(word.firstSeen), last_seen: isoOf(word.lastSeen),
    client_updated_at: Math.round(word.updatedAt)
  })), changed.map((word) => [word.id, String(word.updatedAt)]), pushed.words);

  // Sesiones
  const sessions = (await getAll("sessions")).filter((s) => pushed.sessions[s.id] !== (s.evaluation ? "e" : "s"));
  await pushRows("reading_sessions", "user_id,id", sessions.map((s) => ({
    user_id: userId, id: s.id, text_id: s.textId,
    started_at: isoOf(s.startedAt), finished_at: isoOf(s.finishedAt),
    discarded: !!s.discarded, clicks: s.clicks || {}, evaluation: s.evaluation || null
  })), sessions.map((s) => [s.id, s.evaluation ? "e" : "s"]), pushed.sessions);
}

/* Tras descargar cambios se actualiza lo que esté a la vista, sin cortar una lectura en curso */
function refreshReadingViews() {
  renderLibrary();
  renderReadingStats();
  if (document.body.dataset.view === "read" && !reader && !placement && !evaluation) renderRead();
}

/* =========================================
   13. LECTURA <-> REPASO
   -----------------------------------------
   Las palabras en estado "learning" entran solas en el repaso con
   repetición espaciada, y lo que pasa en el repaso vuelve a la lectura:
   - acertarla marca que sabe leerla; con dos aciertos seguidos pasa a
     "pre_known" para que la siguiente evaluación confirme también el significado;
   - fallarla la devuelve a "learning".
   ========================================= */

/* Nivel JLPT de una palabra según las listas; si no está, el nivel de lectura */
function wordLevel(lemma) {
  return LEVELS.find((level) => levelVocabulary(level).has(lemma)) || meta.reading.level || "N5";
}

/* Crea en el repaso las palabras "learning" con kanji que aún no estén */
async function addLearningToReview() {
  const known = new Set(items.map((i) => i.id));
  const fresh = [];
  for (const word of userWords.values()) {
    if (word.status !== "learning" || !/\p{Script=Han}/u.test(word.lemma)) continue;
    if (known.has(uid("word", word.lemma))) continue;
    const entry = words.get(word.id);
    const item = newItem("word", word.lemma, wordLevel(word.lemma));
    item.source = "reading";
    item.dictionary = {
      v: DICT_VERSION,
      source: "reading",
      readings: [normalizeReading(word.reading)],
      display: { words: [word.reading] },
      meanings: entry?.meanings || []
    };
    item.lookupStatus = "found";
    known.add(item.id);
    fresh.push(item);
  }
  if (!fresh.length) return;
  await saveItems(fresh);
  items.push(...fresh);
  renderAll();
  scheduleSync();
}

/* El progreso de lectura de la palabra que hay detrás de un elemento de repaso */
function userWordOf(item) {
  const reading = item.dictionary?.readings?.[0];
  return item.type === "word" && reading ? userWords.get(wordKey(item.value, reading)) : undefined;
}

/* Lo llama el repaso tras cada respuesta */
async function onReviewGraded(item, correct) {
  const word = userWordOf(item);
  if (!word) return;
  word.canReadKanji = correct;
  if (!correct) word.status = "learning";
  else if (word.status === "learning" && item.repetitions >= 2) word.status = "pre_known";
  await saveUserWord(word);
}
