/* =========================================
   KANJI LEARNING APP - texts.js
   Los textos: almacenamiento, comprobar y preparar un texto (validateText),
   resolver cada palabra (banco, JMdict, IA), guardarlo y la biblioteca.
   Es la primera de cuatro partes que antes eran reading.js; se cargan en este
   orden: texts.js, reading.js, reading-stats.js, reading-sync.js. Todas van
   después de ja-core.js y antes que app.js, y usan sus funciones (db, t, $…).

   Almacenes de IndexedDB (se crean en openDatabase, app.js):
     texts      { id, title, titleEn, titleEs, topic, level, source, status,
                  createdAt, updatedAt, readAt, lemmas: {clave: veces}, total, data }
     words      { id: "lemma|lectura", lemma, reading, meanings, meaningsEs,
                  pos, source: "ai" | "jmdict" | "user", updatedAt }
     userWords  progreso del usuario por palabra (se rellena al leer)
     sessions   sesiones de lectura (se rellenan al leer)
     sentences, sentenceStats   frases de ejemplo (sentences.js)
     translations               frases traducidas (translate.js)
   ========================================= */

const READING_STORES = ["texts", "words", "userWords", "userKanji", "sessions", "sentences", "sentenceStats", "translations"];
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
/* Los tipos que no cuentan para la cobertura (UNCOUNTED_POS) están en ja-core.js */

let texts = [];
let deletedTexts = [];     // textos propios borrados: { id, owner, deletedAt } hasta avisar al servidor
let words = new Map();     // id -> palabra del diccionario
let userWords = new Map(); // id -> progreso del usuario

const wordKey = (lemma, reading) => `${normalizeText(lemma)}|${normalizeReading(reading)}`;
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
  userKanji = new Map();
  userSentences = new Map();
  sentenceStats = new Map();
  translationLog = [];
  translating = null;
  clearReaderState();
  forgetSentenceIndex();
}

/* =========================================
   2. COMPROBAR Y PREPARAR UN TEXTO
   -----------------------------------------
   validateText(texto pegado) -> { errors, text, flagged }

   Un texto solo se RECHAZA si está roto de estructura: no es JSON o los
   tokens no reconstruyen la oración. Todo lo demás se arregla o se completa
   y el texto se muestra igualmente.

   Cada palabra se resuelve en este orden:
     a. en el banco, también con otra escritura (有る/ある, 御飯/ご飯);
     b. por partes si lleva un sufijo (一つずつ = 一つ + ずつ);
     c. en el diccionario general (JMdict), si está disponible;
     d. con la entrada que mandó la IA en "dictionary".
   Lo resuelto por c o d se devuelve en `flagged` para que un administrador lo
   revise (tabla words_to_review). Una palabra que casi siempre va en kana y
   llega con kanji se pasa a kana (有りました -> ありました) y también se anota.
   ========================================= */

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isList = (value) => Array.isArray(value) && value.length > 0;

function normalizePos(pos) {
  const key = String(pos ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TOKEN_POS.includes(key) ? key : POS_ALIASES[key] || null;
}

/* Las IA suelen envolver el JSON en ```json … ``` o añadir una frase alrededor */
function extractJSON(raw) {
  const start = raw.search(/[{[]/); // el formato nuevo también puede llegar como una lista
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

/* Lo único que hace ilegible un texto. La función generate-text de Supabase
   lleva esta misma comprobación (checkStructure). */
function structureErrors(data) {
  const errors = [];
  const fail = (text, params) => errors.push(t(text, params));
  if (!data || typeof data !== "object" || !isList(data.sentences)) {
    fail("“sentences” debe ser una lista con al menos una oración.");
    return errors;
  }
  data.sentences.forEach((sentence, index) => {
    const n = index + 1;
    if (!sentence || typeof sentence !== "object") return fail("Oración {n}: debe ser un objeto.", { n });
    if (!isText(sentence.jp)) return fail("Oración {n}: falta “{field}”.", { n, field: "jp" });
    if (!isList(sentence.tokens)) return fail("Oración {n}: “tokens” debe ser una lista no vacía.", { n });
    const bad = sentence.tokens.findIndex((token) => !token || !isText(token.surface));
    if (bad >= 0) {
      return fail("Oración {n}, token {i} ({surface}): falta “{field}”.", { n, i: bad + 1, surface: "?", field: "surface" });
    }
    const joined = sentence.tokens.map((token) => token.surface).join("");
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
  });
  return errors;
}

/* ---------- Resolver una palabra ---------- */

/* Sufijos que forman compuestos: [escritura, lectura] */
const WORD_SUFFIXES = [
  ["ずつ", "ずつ"], ["たち", "たち"], ["達", "たち"], ["さん", "さん"], ["ちゃん", "ちゃん"], ["くん", "くん"],
  ["さま", "さま"], ["様", "さま"], ["など", "など"], ["ごろ", "ごろ"], ["頃", "ごろ"], ["だけ", "だけ"],
  ["ばかり", "ばかり"], ["くらい", "くらい"], ["ぐらい", "ぐらい"], ["中", "ちゅう"], ["的", "てき"],
  ["目", "め"], ["屋", "や"], ["者", "しゃ"], ["用", "よう"], ["性", "せい"], ["化", "か"]
];

/* Palabras del banco por su lectura: lectura -> [palabras] (para encontrar ある -> 有る).
   Ver en ja-core.js las reglas para elegir cuando hay varias. */
const bankByReading = (() => {
  let size = -1, index;
  return () => {
    if (size !== BANK.words.size) {
      index = new Map();
      for (const word of BANK.words.values()) {
        const key = normalizeReading(word.r);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(word);
      }
      size = BANK.words.size;
    }
    return index;
  };
})();
const readingCandidates = (lemma) => bankByReading().get(normalizeReading(lemma)) || [];

/* a. En el banco: tal cual, con el prefijo de cortesía escrito de otra forma
   (御飯 / ご飯 / お茶) o, si llega en kana, por su lectura */
function bankLookup(lemma, reading) {
  const pick = (writing) => {
    const senses = BANK.sensesOf(writing); // también 終わる -> 終る (bank/aliases.js)
    if (!senses) return null;
    return reading && BANK.words.get(BANK.id(writing, reading)) || senses[0];
  };
  let word = pick(lemma);
  if (!word && lemma.startsWith("御")) word = pick("ご" + lemma.slice(1)) || pick("お" + lemma.slice(1));
  if (!word && /^[ごお]/.test(lemma) && lemma.length > 1) word = pick("御" + lemma.slice(1));
  // En kana: solo una palabra que casi siempre se escribe así (regla 1 de ja-core.js)
  if (!word && isKana(lemma)) word = kanaFormWord(readingCandidates(lemma));
  return word;
}

const bankEntry = (word, pos) => ({ reading: word.r, meanings: word.en, meanings_es: word.es, pos: pos || "" });

/* Devuelve { entry, source, word } con source: bank | parts | approved | jmdict | ai | none.
   Orden: banco, diccionario general, compuesto con sufijo, lo que explicó la IA
   y, en kana, la única palabra del banco con esa lectura. */
function resolveWord(lemma, given, extra) {
  const reading = isText(given?.reading) ? normalizeText(given.reading) : "";
  const word = bankLookup(lemma, reading);
  if (word) return { entry: bankEntry(word, given?.pos), source: "bank", word };

  // b. Diccionario general (JMdict): antes que las partes, porque sabe leer 一日中 (いちにちじゅう)
  const found = extra.get(lemma);
  if (found) {
    return {
      entry: { reading: found.reading, meanings: found.meanings || [], meanings_es: found.meanings_es || [], pos: given?.pos || "" },
      // Una palabra ya aprobada es de fiar: no vuelve a la lista de revisión
      source: found.source === "approved" ? "approved" : "jmdict", word: null, uk: found.uk
    };
  }

  // c. Compuesto con sufijo: el significado sale de la primera parte
  for (const [suffix, suffixReading] of WORD_SUFFIXES) {
    if (!lemma.endsWith(suffix) || lemma.length <= suffix.length) continue;
    const stem = bankLookup(lemma.slice(0, -suffix.length), "");
    if (!stem) continue;
    return {
      source: "parts", word: null,
      entry: {
        reading: reading || stem.r + suffixReading,
        meanings: isList(given?.meanings) ? given.meanings : stem.en,
        meanings_es: isList(given?.meanings_es) ? given.meanings_es : stem.es,
        pos: given?.pos || ""
      }
    };
  }

  // c2. Un potencial (買える) que no está en el banco es su verbo (買う)
  const base = potentialBase(lemma);
  const verb = base && !BANK.sensesOf(lemma) ? bankLookup(base, "") : null;
  if (verb) return { entry: bankEntry(verb, given?.pos), source: "bank", word: verb };

  // d. Lo que explicó la IA
  if (given && typeof given === "object") {
    return {
      source: "ai", word: null,
      entry: {
        reading,
        meanings: isList(given.meanings) ? given.meanings.filter(isText) : [],
        meanings_es: isList(given.meanings_es) ? given.meanings_es.filter(isText) : [],
        pos: isText(given.pos) ? given.pos.trim() : ""
      }
    };
  }
  // e. En kana, la única palabra del banco que se lee así (いう -> 言う)
  const only = isKana(lemma) ? onlyHomophone(readingCandidates(lemma)) : null;
  if (only) return { entry: bankEntry(only, given?.pos), source: "bank", word: only };
  return { entry: { reading: "", meanings: [], meanings_es: [], pos: "" }, source: "none", word: null };
}

/* Diccionario general en el propio dispositivo: las palabras comunes de JMdict
   que no están en el banco (vendor/jmdict, unos 740 kB comprimido). Se descarga
   la primera vez que hace falta y el service worker lo guarda para siempre.
   Así funciona sin sesión y sin conexión. Lo genera tools/build-dictionary.mjs. */
const JMDICT_FILE = "vendor/jmdict/common-2026-10-20.json";
let localDictionary = null; // promesa de Map(lemma -> fila); el Map lleva también .rows, todas las filas

function loadLocalDictionary() {
  return localDictionary ??= fetch(JMDICT_FILE)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
    .then((list) => {
      const map = new Map(), rows = [];
      // Las filas vienen de la más común a la menos: para cada escritura vale la primera
      for (const [lemma, reading, meanings, meanings_es, uk] of list) {
        const row = { lemma, reading, meanings, meanings_es, uk: !!uk, source: "jmdict" };
        rows.push(row);
        if (!map.has(lemma)) map.set(lemma, row);
      }
      map.rows = rows;
      return map;
    })
    .catch((error) => {
      console.error("No se pudo cargar el diccionario general:", error);
      localDictionary = null; // sin conexión la primera vez: se reintenta la próxima
      return Object.assign(new Map(), { rows: [] });
    });
}

/* Consulta en el diccionario general las palabras que no están en el banco.
   Primero en el dispositivo; con sesión, además, en la tabla dictionary de
   Supabase: lo aprobado por un administrador manda, y lo que el archivo no
   tenga se completa desde ahí. Devuelve Map(lemma -> { reading, meanings, meanings_es, uk, source }). */
async function lookupDictionary(lemmas) {
  const found = new Map();
  if (!lemmas.length) return found;
  const local = await loadLocalDictionary();
  for (const lemma of lemmas) if (local.has(lemma)) found.set(lemma, local.get(lemma));
  if (!sb || !sync.user || !navigator.onLine) return found;
  try {
    for (let i = 0; i < lemmas.length; i += 100) {
      const { data, error } = await sb.from("dictionary")
        .select("lemma, reading, meanings, meanings_es, uk, source").in("lemma", lemmas.slice(i, i + 100));
      if (error) throw error;
      for (const row of data) {
        // Lo aprobado por un administrador manda sobre la entrada de JMdict
        if (row.source === "approved" || !found.has(row.lemma)) found.set(row.lemma, row);
      }
    }
  } catch (error) {
    console.error("No se pudo consultar el diccionario:", error); // la lectura sigue con lo que haya
  }
  return found;
}

/* ---------- Reparar significados de una versión anterior ----------
   Antes, una palabra escrita en kana tomaba el significado de la primera
   palabra del banco que se leyera igual: なる salía como 鳴る "sonar" y いる
   como 要る "necesitar". Esos significados quedaron guardados en los textos y
   en el diccionario del usuario. Aquí se detectan (el significado es justo el
   de una de esas palabras) y se sustituyen por el bueno, o se dejan vacíos si
   no se sabe cuál es. */

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/* El significado bueno de una palabra en kana, o null si no se sabe */
function kanaMeaning(lemma, local) {
  const candidates = readingCandidates(lemma);
  const word = kanaFormWord(candidates);
  if (word) return { reading: word.r, meanings: word.en, meanings_es: word.es };
  const row = local.get(lemma);
  if (row) return { reading: row.reading, meanings: row.meanings, meanings_es: row.meanings_es };
  const only = onlyHomophone(candidates);
  return only ? { reading: only.r, meanings: only.en, meanings_es: only.es } : null;
}

/* Cambia en su sitio una entrada con el significado equivocado. Devuelve si cambió. */
function repairKanaEntry(lemma, entry, local) {
  if (!entry || !isKana(lemma) || BANK.byWriting.has(lemma)) return false;
  const wrong = readingCandidates(lemma).find((word) => !word.kana && sameList(entry.meanings, word.en));
  if (!wrong) return false;
  const right = kanaMeaning(lemma, local);
  if (right && sameList(right.meanings, wrong.en)) return false; // era la buena
  entry.meanings = right?.meanings || [];
  entry.meanings_es = right?.meanings_es || [];
  if (right && "meaningsEs" in entry) { entry.meaningsEs = right.meanings_es; delete entry.meanings_es; }
  return true;
}

/* Repara unos textos (en su sitio). Devuelve los que cambiaron. */
async function repairTexts(list) {
  if (!list.length) return [];
  await BANK.loadUpTo("N1").catch(() => {});
  const local = await loadLocalDictionary();
  const changed = [];
  for (const text of list) {
    let touched = false;
    for (const sentence of text.data?.sentences || []) {
      for (const [lemma, entry] of Object.entries(sentence.dictionary || {})) {
        if (repairKanaEntry(lemma, entry, local)) touched = true;
      }
    }
    if (touched) changed.push(text);
  }
  return changed;
}

/* Una sola vez por dispositivo: textos guardados y diccionario del usuario */
async function repairKanaMeanings() {
  if (prefs.kanaRepair === 1 || !texts.length && !words.size) {
    prefs.kanaRepair = 1;
    return saveLocal("kanji-prefs", prefs);
  }
  const local = await loadLocalDictionary();
  if (!local.size) return; // sin el diccionario no se sabe el significado bueno: se reintenta otro día
  const fixedTexts = await repairTexts(texts);
  const fixedWords = [];
  for (const entry of words.values()) {
    const shaped = { meanings: entry.meanings, meaningsEs: entry.meaningsEs };
    if (repairKanaEntry(entry.lemma, shaped, local)) {
      Object.assign(entry, { meanings: shaped.meanings, meaningsEs: shaped.meaningsEs, updatedAt: Date.now() });
      fixedWords.push(entry);
    }
  }
  await putRecords("texts", fixedTexts);
  await putRecords("words", fixedWords);
  if (fixedTexts.length || fixedWords.length) console.info(`Significados reparados: ${fixedTexts.length} textos, ${fixedWords.length} palabras.`);
  prefs.kanaRepair = 1;
  saveLocal("kanji-prefs", prefs);
}

/* Una respuesta cortada a medias (pasa al pegar en el móvil o cuando la IA no
   termina de escribir): devuelve el JSON con las oraciones que sí llegaron
   completas, o null si no hay ninguna. */
function recoverSentences(raw) {
  const text = raw.slice(Math.max(0, raw.indexOf("{")));
  const key = text.indexOf('"sentences"');
  const open = key < 0 ? -1 : text.indexOf("[", key);
  if (open < 0) return null;

  let depth = 0, inString = false, escaped = false, lastEnd = -1, count = 0;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      if (depth === 0) break; // fin del array: no estaba cortado aquí
      depth--;
      if (depth === 0 && ch === "}") { lastEnd = i; count++; }
    }
  }
  if (lastEnd < 0) return null;
  try {
    return { count, json: JSON.stringify(JSON.parse(`${text.slice(0, lastEnd + 1)}]}`)) };
  } catch {
    return null;
  }
}

/* ---------- Formato nuevo: texto segmentado con "|" ---------- */

let tokenizerPromise = null;

/* kuromoji y su diccionario (unos 18 MB) se descargan la primera vez que hacen
   falta; después quedan guardados. Van dentro de la app (vendor/kuromoji)
   porque la librería no sabe cargar su diccionario desde otra dirección. */
function loadTokenizer() {
  return tokenizerPromise ??= new Promise((resolve, reject) => {
    const build = () => window.kuromoji.builder({ dicPath: "vendor/kuromoji/dict/" })
      .build((error, tokenizer) => error ? reject(error) : resolve(tokenizer));
    if (window.kuromoji) return build();
    const script = document.createElement("script");
    script.src = "vendor/kuromoji/kuromoji.js";
    script.onload = build;
    script.onerror = () => reject(new Error("kuromoji"));
    document.head.appendChild(script);
  }).catch((error) => { tokenizerPromise = null; throw error; });
}

const isSegmented = (data) => {
  const list = Array.isArray(data) ? data : data?.sentences;
  return Array.isArray(list) && list.some((sentence) => typeof sentence?.ja === "string");
};

/* Lo que hace inservible un texto segmentado (la función generate-text lleva
   la misma comprobación, checkSegmented) */
function segmentErrors(data) {
  const errors = [];
  const list = Array.isArray(data) ? data : data.sentences;
  if (!isList(list)) return [t("“sentences” debe ser una lista con al menos una oración.")];
  list.forEach((sentence, index) => {
    const n = index + 1;
    if (!sentence || !isText(sentence.ja)) return errors.push(t("Oración {n}: falta “{field}”.", { n, field: "ja" }));
    if (sentence.ja.split("|").some((unit) => !unit.trim())) {
      errors.push(t("Oración {n}: hay una unidad vacía (dos “|” seguidos, o uno al principio o al final).", { n }));
    }
  });
  return errors;
}

/* El análisis de las unidades (unitOf, analyseUnits…) está en ja-core.js */

/* Convierte el formato segmentado en el que usa la app: a cada unidad le pone
   lema, lectura y tipo con kuromoji, sin IA. Resolución de cada unidad:
     1. la forma exacta está en el diccionario;
     2. su lema (forma de diccionario) está en el diccionario;
     3. la IA segmentó mal: se prueba a unirla con la siguiente o a dividirla;
     4. si no, se queda con su lema y sigue el camino normal de palabras sin resolver. */
async function fromSegmented(data, repairs) {
  const tokenizer = await loadTokenizer();
  const list = Array.isArray(data) ? data : data.sentences;

  const analysed = list.map((sentence) => analyseUnits(tokenizer, sentence.ja));

  // Una sola consulta al diccionario general con todo lo que el banco no tiene
  const wanted = new Set();
  const want = (form) => { if (form && !bankLookup(form, "")) wanted.add(form); };
  for (const units of analysed) {
    units.forEach((unit, i) => {
      if (unit.punct || UNCOUNTED_POS.has(unit.pos)) return;
      want(unit.surface);
      want(unit.basic);
      if (units[i + 1] && !units[i + 1].punct) want(unit.surface + units[i + 1].surface);
      unit.pieces.filter(isContentPiece).forEach((piece) => want(pieceBase(piece)));
    });
  }
  const extra = await lookupDictionary([...wanted]);
  const known = (form) => !!bankLookup(form, "") || extra.has(form);
  const token = (unit, lemma) => ({ surface: unit.surface, lemma, reading: unit.reading, pos: unit.pos, morph: unit.morph });

  const sentences = list.map((sentence, index) => {
    const units = analysed[index], tokens = [];
    for (let i = 0; i < units.length; i++) {
      const unit = units[i], next = units[i + 1];
      if (unit.punct || UNCOUNTED_POS.has(unit.pos)) { tokens.push(token(unit, unit.surface)); continue; }
      if (known(unit.surface)) { tokens.push(token(unit, unit.surface)); continue; }
      if (known(unit.basic)) { tokens.push(token(unit, unit.basic)); continue; }

      // 3a. Unida a la siguiente forma una palabra del diccionario (食事 + 中)
      if (next && !next.punct && known(unit.surface + next.surface)) {
        const joined = unitOf([...unit.pieces, ...next.pieces]);
        tokens.push(token(joined, joined.surface));
        repairs.push(`units merged: ${unit.surface}|${next.surface}`);
        i++;
        continue;
      }
      // 3b. Eran varias palabras en una unidad: se divide por sus piezas con contenido
      const content = unit.pieces.filter(isContentPiece);
      if (content.length > 1 && content.every((piece) => known(pieceBase(piece)))) {
        const groups = [];
        for (const piece of unit.pieces) {
          if (isContentPiece(piece) || !groups.length) groups.push([piece]);
          else groups[groups.length - 1].push(piece);
        }
        for (const group of groups) {
          const part = unitOf(group);
          tokens.push(token(part, part.basic));
        }
        repairs.push(`unit split: ${unit.surface}`);
        continue;
      }
      tokens.push(token(unit, unit.basic)); // 4. sin resolver
    }
    return {
      id: index + 1, paragraph: Number.isInteger(sentence.p) ? sentence.p : sentence.paragraph,
      jp: tokens.map((tok) => tok.surface).join(""), en: sentence.en, es: sentence.es,
      tokens, dictionary: {}
    };
  });
  const head = Array.isArray(data) ? {} : data;
  return { title: head.title, title_en: head.title_en, title_es: head.title_es, topic: head.topic, level: head.level, sentences };
}

async function validateText(raw) {
  let data;
  try {
    data = JSON.parse(extractJSON(String(raw)));
  } catch (error) {
    const partial = recoverSentences(String(raw));
    const errors = partial
      ? [t("La respuesta está incompleta: llegaron {chars} caracteres y el JSON se corta a medias. Suele pasar al pegar en el móvil o cuando la IA no termina de escribir. Prueba el botón “Pegar del portapapeles”, o pega el resto a continuación.", { chars: String(raw).length })]
      : [t("No es un JSON válido: {error}", { error: error.message })];
    return { errors, text: null, flagged: [], repairs: [], partial };
  }
  const repairs = []; // lo que la app tuvo que arreglar: sirve para mejorar el prompt
  // Un texto puede traer palabras de cualquier nivel: para reconocerlas hace falta el banco entero
  await BANK.loadUpTo("N1").catch(() => {});
  const segmented = isSegmented(data);
  if (segmented) {
    const broken = segmentErrors(data);
    if (broken.length) return { errors: broken, text: null, flagged: [], repairs };
    try {
      data = await fromSegmented(data, repairs);
    } catch (error) {
      console.error("No se pudo analizar el texto:", error);
      return { errors: [t("No se pudo cargar el analizador de japonés (unos 18 MB la primera vez). Comprueba la conexión y vuelve a intentarlo.")], text: null, flagged: [], repairs };
    }
  }
  const errors = structureErrors(data);
  if (errors.length) return { errors: [...new Set(errors)], text: null, flagged: [], repairs };

  // Lo que explicó la IA, de cualquier oración del texto
  const given = new Map();
  for (const sentence of data.sentences) {
    if (!sentence.dictionary || typeof sentence.dictionary !== "object") continue;
    for (const [lemma, entry] of Object.entries(sentence.dictionary)) if (!given.has(lemma)) given.set(lemma, entry);
  }

  // Tokens con valores seguros, y las palabras que hay que buscar fuera del banco
  const pending = new Set();
  const sentences = data.sentences.map((sentence, index) => {
    const tokens = sentence.tokens.map((token) => {
      const surface = token.surface;
      let pos = normalizePos(token.pos) || (PUNCTUATION.test(surface) ? "punctuation" : "expression");
      // 一人, 一日, 二つ: kuromoji los marca como número, pero son palabras del banco que se estudian
      if ((pos === "number" || pos === "counter") && BANK.sensesOf(surface)) pos = "noun";
      const lemma = isText(token.lemma) ? normalizeText(token.lemma) : surface;
      const reading = isText(token.reading) ? normalizeText(token.reading) : isKana(surface) ? surface : "";
      if (!normalizePos(token.pos)) repairs.push(`pos: ${surface} (${token.pos ?? "missing"})`);
      if (!isText(token.lemma)) repairs.push(`lemma missing: ${surface}`);
      if (!isText(token.reading) && pos !== "punctuation" && pos !== "symbol") repairs.push(`reading missing: ${surface}`);
      if (!UNCOUNTED_POS.has(pos) && !bankLookup(lemma, "")) pending.add(lemma);
      return { surface, lemma, reading, pos, ...(token.morph ? { morph: token.morph } : {}) }; // la clave se pone al resolverla
    });
    for (const field of ["en", "es"]) if (!isText(sentence[field])) repairs.push(`sentence ${index + 1}: "${field}" missing`);
    return {
      id: index + 1,
      ...(Number.isInteger(sentence.paragraph) && sentence.paragraph > 0 ? { paragraph: sentence.paragraph } : {}),
      en: isText(sentence.en) ? sentence.en : isText(sentence.es) ? sentence.es : "",
      es: isText(sentence.es) ? sentence.es : isText(sentence.en) ? sentence.en : "",
      tokens
    };
  });
  const extra = await lookupDictionary([...pending]);

  const flagged = new Map(); // "lemma|fuente" -> palabra por revisar
  for (const sentence of sentences) {
    const original = sentence.tokens.map((token) => token.surface).join("");
    sentence.dictionary = {};
    // Una entrada por palabra ("escritura|lectura"): una misma escritura puede ser
    // dos palabras en el mismo texto (角 かど "esquina" y 角 つの "cuerno").
    // `dictionary` (por lema) se mantiene para las versiones anteriores de la app.
    sentence.entries = {};
    for (const token of sentence.tokens) {
      if (UNCOUNTED_POS.has(token.pos) && !given.has(token.lemma)) continue;
      // Si la escritura tiene varias lecturas en el banco, vale la que suena en esta frase
      const senses = BANK.sensesOf(token.lemma) || [];
      const heard = senses.length > 1 ? senses.find((sense) => readingMatches(token, token.lemma, sense.r)) : null;
      const hint = heard ? { ...(given.get(token.lemma) || {}), reading: heard.r } : given.get(token.lemma);
      const { entry, source, word, uk } = resolveWord(token.lemma, hint, extra);
      if (source === "none") {
        token.pos = UNCOUNTED_POS.has(token.pos) ? token.pos : "expression";
        repairs.push(`dictionary entry missing: ${token.lemma}`);
      }
      if (!entry.reading) entry.reading = isKana(token.lemma) ? token.lemma : token.reading;
      if (!isKana(entry.reading || "")) continue; // sin lectura fiable no se puede enlazar: queda como texto

      // kuromoji a veces lee mal una palabra que solo tiene una lectura (雨 -> う):
      // para el furigana manda la del banco o la de JMdict. Lo mismo si la escritura
      // tiene varias lecturas y kuromoji dio otra distinta: así furigana y significado
      // son de la misma palabra (角 leído かく con el significado de 角 かど "esquina").
      const sure = source === "bank" && word ? [word.r, ...word.alt] : source === "jmdict" ? [entry.reading] : [];
      if (sure.length && token.surface === token.lemma && token.reading && (senses.length <= 1 || !heard) &&
          !sure.some((r) => normalizeReading(r) === normalizeReading(token.reading))) {
        repairs.push(`reading fixed: ${token.surface} ${token.reading} -> ${sure[0]}`);
        token.reading = sure[0];
      }

      // Casi siempre va en kana y llegó con kanji: se muestra en kana
      const kanaForm = (word?.kana || uk) && /\p{Script=Han}/u.test(token.surface) && isKana(token.reading);
      if (kanaForm) {
        flagged.set(`${token.lemma}|kana_fix`, {
          lemma: token.lemma, reading: entry.reading, meanings: entry.meanings, meanings_es: entry.meanings_es,
          source: "kana_fix", sentence: original
        });
        token.surface = token.reading;
        token.lemma = entry.reading;
      } else if (source === "jmdict" || source === "ai" || source === "none") {
        // Sin explicación de nadie también se anota (como "ai"), para completarla a mano
        const from = source === "jmdict" ? "jmdict" : "ai";
        flagged.set(`${token.lemma}|${from}`, {
          lemma: token.lemma, reading: entry.reading, meanings: entry.meanings, meanings_es: entry.meanings_es,
          source: from, sentence: original
        });
      }
      token.key = wordKey(token.lemma, entry.reading);
      sentence.entries[token.key] = entry;
      sentence.dictionary[token.lemma] ??= entry;
    }
    sentence.jp = sentence.tokens.map((token) => token.surface).join("");
  }

  const title = isText(data.title) ? data.title.trim() : sentences[0].jp.slice(0, 20);
  // En el formato nuevo el tema y el nivel los pone la app: que falten no es un fallo de la IA
  for (const field of segmented ? ["title", "title_en", "title_es"] : ["title", "title_en", "title_es", "topic", "level"]) {
    if (field === "level" ? !LEVELS.includes(data.level) : !isText(data[field])) repairs.push(`"${field}" missing or invalid`);
  }
  for (const word of flagged.values()) if (word.source === "kana_fix") repairs.push(`kanji for a kana word: ${word.lemma}`);
  return {
    errors: [],
    segmented,
    repairs,
    flagged: [...flagged.values()],
    text: {
      title,
      title_en: isText(data.title_en) ? data.title_en.trim() : isText(data.title_es) ? data.title_es.trim() : title,
      title_es: isText(data.title_es) ? data.title_es.trim() : isText(data.title_en) ? data.title_en.trim() : title,
      topic: isText(data.topic) ? data.topic.trim() : "general",
      level: LEVELS.includes(data.level) ? data.level : meta.reading.level || "N5",
      ...(isText(data.type) ? { type: data.type.trim() } : {}),
      sentences
    }
  };
}

/* Comprueba, guarda y anota las palabras por revisar. Lanza la lista de
   errores si el texto está roto. Lo usan las tres formas de agregar un texto. */
async function addText(raw, source = "manual", origin = {}) {
  const { errors, text, flagged, repairs, partial, segmented } = await validateText(raw);
  if (errors.length) throw Object.assign(errors, { partial });
  // Pegado en el modo manual: la versión es la del prompt del formato que llegó
  if (!origin.promptVersion) origin = { ...origin, promptVersion: segmented ? SEGMENTED_VERSION : PROMPT_VERSION };
  if (origin.topic) text.topic = origin.topic; // el formato nuevo no trae tema ni nivel: los pone la app
  if (origin.level) text.level = origin.level;
  const record = await saveText(text, source, origin);
  reportWords(flagged, record.id);
  // Lo que hubo que arreglar queda registrado junto a la generación
  if (repairs.length) sendReport(record, "auto", "repaired", "", { repairs: repairs.slice(0, 60) });
  return record;
}

/* Registro de problemas de un texto (tabla text_reports): los que arregla la app
   sola ("auto") y los que marca una persona con el botón "Reportar error" ("user") */
async function sendReport(record, kind, category, comment = "", details = {}) {
  if (!sb || !sync.user) return false;
  const { error } = await sb.from("text_reports").insert({
    text_id: record.id, request_id: record.requestId || null,
    prompt_version: record.promptVersion || null, model: record.model || null,
    kind, category, comment: comment.slice(0, 2000),
    details: { title: record.title, level: record.level, topic: record.topic, source: record.source, ...details },
    user_id: sync.user.id
  });
  if (error) console.error("No se pudo guardar el reporte:", error);
  return !error;
}

/* Las palabras por revisar van a Supabase si hay sesión; nunca bloquean la lectura */
async function reportWords(flagged, textId) {
  if (!flagged.length || !sb || !sync.user) return;
  const rows = flagged.map((word) => ({
    lemma: word.lemma, reading: word.reading || "", meanings: word.meanings || [], meanings_es: word.meanings_es || [],
    source: word.source, sentence: word.sentence, text_id: textId, user_id: sync.user.id
  }));
  const { error } = await sb.from("words_to_review")
    .upsert(rows, { onConflict: "lemma,reading,source", ignoreDuplicates: true });
  if (error) console.error("No se pudieron anotar las palabras por revisar:", error);
}

/* =========================================
   3. GUARDAR UN TEXTO
   ========================================= */

/* Palabras de un texto tal como las ve quien lee: todos los tokens salvo la puntuación */
const wordCount = (data) => data.sentences.reduce((sum, sentence) =>
  sum + sentence.tokens.filter((token) => token.pos !== "punctuation" && token.pos !== "symbol").length, 0);

/* Palabras que cuentan para la cobertura: { "lemma|lectura": veces } */
function countLemmas(data) {
  const lemmas = {};
  let total = 0;
  const dictionary = {};
  for (const sentence of data.sentences) Object.assign(dictionary, sentence.dictionary);
  for (const sentence of data.sentences) {
    for (const token of sentence.tokens) {
      if (UNCOUNTED_POS.has(token.pos)) continue;
      // Textos nuevos: la clave va en el token; los anteriores solo tienen el diccionario por lema
      const key = token.key || (dictionary[token.lemma] ? wordKey(token.lemma, dictionary[token.lemma].reading) : "");
      if (!key) continue; // sin entrada no es una palabra enlazable
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
    // Las entradas por palabra si las hay (textos nuevos); si no, las del diccionario por lema
    const list = sentence.entries
      ? Object.entries(sentence.entries).map(([key, entry]) => [key.slice(0, key.lastIndexOf("|")), entry])
      : Object.entries(sentence.dictionary || {});
    for (const [lemma, entry] of list) {
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

async function saveText(data, source = "manual", origin = {}) {
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
    // De qué generación salió, para poder relacionar un reporte con su registro
    requestId: origin.requestId || "", promptVersion: origin.promptVersion ?? PROMPT_VERSION, model: origin.model || "",
    owner: "",         // se rellena al subirlo con la sesión iniciada
    status: "private", // al subirlo pasa a "pending"; un administrador lo aprueba
    // Un texto pegado tal cual (un artículo) se queda en este dispositivo: nunca se sube
    ...(origin.local ? { local: true } : {}),
    createdAt: now, updatedAt: now, readAt: null,
    ...countLemmas(data),
    data
  };
  await putRecords("texts", [record]);
  await putRecords("words", wordsFromText(data));
  texts.push(record);
  scheduleSync();
  await indexTextsQuietly([record]); // sus frases, para repasar palabras dentro de una frase
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
  await dropTextSentences(id);
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
  const shareTag = (text) => text.local ? t("Solo en este dispositivo")
    : !isOwnText(text) ? t("De la comunidad")
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
          ${escapeHTML(title)} · ${escapeHTML(text.level)} · ${escapeHTML(text.topic)} ·
          ${plural(wordCount(text.data), "palabra", "palabras")} · ${date}${
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

/* Error al agregar un texto pegado. Si estaba cortado pero traía oraciones
   completas, ofrece guardar solo esas (nunca se recorta sin avisar). */
function showPasteError(error, target, usePartial) {
  showTextErrors([].concat(error.message || error), target);
  const partial = error.partial;
  if (!partial) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-outline partial-btn";
  button.textContent = t("Guardar solo las {n} completas", { n: plural(partial.count, "oración", "oraciones") });
  button.onclick = () => usePartial(partial.json);
  target.appendChild(button);
}

/* Cuadro para pegar: cuenta lo que llegó y permite pegar con el portapapeles
   del navegador, que no pasa por el teclado del móvil (donde a veces se corta) */
function bindPasteBox(box, counter, button) {
  const update = () => { counter.textContent = box.value ? t("{n} caracteres", { n: box.value.length }) : ""; };
  box.addEventListener("input", update);
  button.addEventListener("click", async () => {
    try {
      box.value = await navigator.clipboard.readText();
    } catch {
      counter.textContent = t("El navegador no dejó leer el portapapeles: mantén pulsado el cuadro y elige Pegar.");
      return;
    }
    update();
  });
  update();
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

/* ¿Lo pegado es japonés tal cual (un artículo) y no el JSON de un texto? */
const isPlainJapanese = (raw) => !/^\s*(```|[{[])/.test(raw) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(raw);
const ARTICLE_MAX = 20000; // caracteres

/* Guarda un texto japonés pegado tal cual. No interviene ninguna IA: kuromoji
   lo divide en unidades y el banco y el diccionario ponen los significados, por
   el mismo camino que un texto segmentado. No trae traducción. Es privado: se
   queda en este dispositivo, no se sube ni se propone a la comunidad, y no se
   anotan sus palabras ni sus arreglos en el servidor. */
async function addArticle(raw) {
  const clean = String(raw).normalize("NFC").trim();
  if (clean.length > ARTICLE_MAX) throw [t("El texto es demasiado largo ({n} caracteres; el máximo es {max}). Pégalo en partes.", { n: clean.length, max: ARTICLE_MAX })];
  let tokenizer;
  try {
    tokenizer = await loadTokenizer();
  } catch {
    throw [t("No se pudo cargar el analizador de japonés (unos 18 MB la primera vez). Comprueba la conexión y vuelve a intentarlo.")];
  }
  let parts = splitSentences(clean);
  // Una primera línea corta y sin punto final es el título
  let title = "";
  if (parts.length > 1 && parts[0].p !== parts[1].p && [...parts[0].text].length <= 40 && !/[。！？!?]$/.test(parts[0].text)) {
    title = parts.shift().text;
  }
  parts = parts.filter((part) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part.text));
  if (!parts.length) throw [t("No se encontró ninguna oración en japonés.")];
  const data = {
    title: title || [...parts[0].text].slice(0, 20).join(""),
    sentences: parts.map((part) => ({ p: part.p, ja: segmentSentence(tokenizer, part.text), en: "", es: "" }))
  };
  const { errors, text } = await validateText(JSON.stringify(data));
  if (errors.length) throw errors;
  text.title_en = text.title_es = t("Texto pegado");
  text.topic = "article";
  for (const sentence of text.sentences) sentence.en = sentence.es = ""; // sin traducción
  return saveText(text, "paste", { local: true, promptVersion: "" }); // no lo escribió ninguna IA
}

async function addTextFromInput() {
  const raw = $("textInput").value;
  if (!raw.trim()) {
    $("textMessage").className = "message";
    $("textMessage").textContent = t("Pega primero el texto.");
    return;
  }
  // Ni japonés ni el JSON de un texto (empieza por { o [): mejor decirlo que hablar de JSON
  if (!/^\s*(```|[{[])/.test(raw) && !isPlainJapanese(raw)) {
    return showTextErrors([t("Pega un texto en japonés o el JSON que te devolvió la IA.")]);
  }
  if (isPlainJapanese(raw)) {
    $("textMessage").className = "message";
    $("textMessage").textContent = t("Analizando el texto… la primera vez se descarga el analizador de japonés (18 MB).");
    try {
      const record = await addArticle(raw);
      $("textInput").value = "";
      $("textMessage").className = "message correct";
      $("textMessage").textContent = t("Texto guardado: {title} ({n}). Se queda solo en este dispositivo: no se sube ni se comparte.", {
        title: record.title, n: plural(record.data.sentences.length, "oración", "oraciones") });
      renderLibrary();
    } catch (error) {
      showTextErrors([].concat(Array.isArray(error) ? error : error.message || String(error)));
    }
    return;
  }

  if (pendingOwnText()) {
    return showTextErrors([t("Tienes un texto sin terminar ({title}). Léelo o sáltalo antes de agregar otro.", { title: pendingOwnText().title })]);
  }
  const save = async (content) => {
    const record = await addText(content);
    $("textInput").value = "";
    $("textMessage").className = "message correct";
    $("textMessage").textContent = t("Texto guardado: {title} ({n}).", {
      title: record.title,
      n: plural(record.data.sentences.length, "oración", "oraciones")
    });
    renderLibrary();
  };
  const fail = (error) => showPasteError(error, $("textMessage"), (json) => save(json).catch(fail));
  await save(raw).catch(fail);
}

function bindLibrary() {
  bindPasteBox($("textInput"), $("textInputCount"), $("textPasteBtn"));
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
    const skipping = isOwnText(text) && !text.local && !text.readAt;
    if (skipping && await skipsUsed() >= MAX_SKIPS) {
      return alert(t("Ya saltaste {n} textos seguidos: termina este para poder crear otro.", { n: MAX_SKIPS }));
    }
    if (confirm(t("¿Eliminar el texto “{title}”?", { title: text.title }))) {
      if (skipping) await skipText(text); else await deleteText(text.id);
      renderLibrary();
    }
  });
}
