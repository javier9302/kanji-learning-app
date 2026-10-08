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

const READING_STORES = ["texts", "words", "userWords", "userKanji", "sessions"];
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
  userKanji = new Map();
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
const PUNCTUATION = /^[\s\p{P}\p{S}]+$/u;

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

/* Palabras del banco por su lectura, para encontrar ある -> 有る */
const bankByReading = (() => {
  let size = -1, index;
  return () => {
    if (size !== BANK.words.size) {
      index = new Map();
      for (const word of BANK.words.values()) {
        const key = normalizeReading(word.r);
        if (!index.has(key)) index.set(key, word);
      }
      size = BANK.words.size;
    }
    return index;
  };
})();

/* a. En el banco: tal cual, con el prefijo de cortesía escrito de otra forma
   (御飯 / ご飯 / お茶) o, si llega en kana, por su lectura */
function bankLookup(lemma, reading) {
  const pick = (writing) => {
    const senses = BANK.byWriting.get(writing);
    if (!senses) return null;
    return reading && BANK.words.get(BANK.id(writing, reading)) || senses[0];
  };
  let word = pick(lemma);
  if (!word && lemma.startsWith("御")) word = pick("ご" + lemma.slice(1)) || pick("お" + lemma.slice(1));
  if (!word && /^[ごお]/.test(lemma) && lemma.length > 1) word = pick("御" + lemma.slice(1));
  if (!word && isKana(lemma)) word = bankByReading().get(normalizeReading(lemma)) || null;
  return word;
}

const bankEntry = (word, pos) => ({ reading: word.r, meanings: word.en, meanings_es: word.es, pos: pos || "" });

/* Devuelve { entry, source, word } con source: bank | parts | approved | jmdict | ai | none */
function resolveWord(lemma, given, extra) {
  const reading = isText(given?.reading) ? normalizeText(given.reading) : "";
  const word = bankLookup(lemma, reading);
  if (word) return { entry: bankEntry(word, given?.pos), source: "bank", word };

  // b. Compuesto con sufijo: el significado sale de la primera parte
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

  // c. Diccionario general
  const found = extra.get(lemma);
  if (found) {
    return {
      entry: { reading: found.reading, meanings: found.meanings || [], meanings_es: found.meanings_es || [], pos: given?.pos || "" },
      // Una palabra ya aprobada es de fiar: no vuelve a la lista de revisión
      source: found.source === "approved" ? "approved" : "jmdict", word: null, uk: found.uk
    };
  }

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
  return { entry: { reading: "", meanings: [], meanings_es: [], pos: "" }, source: "none", word: null };
}

/* c. Consulta en el diccionario general las palabras que no están en el banco.
   Devuelve Map(lemma -> { reading, meanings, meanings_es, uk }). */
async function lookupDictionary(lemmas) {
  const found = new Map();
  if (!lemmas.length || !sb || !sync.user) return found; // sin sesión se usa lo que explique la IA
  try {
    for (let i = 0; i < lemmas.length; i += 100) {
      const { data, error } = await sb.from("dictionary")
        .select("lemma, reading, meanings, meanings_es, uk, source").in("lemma", lemmas.slice(i, i + 100));
      if (error) throw error;
      for (const row of data) {
        // Lo aprobado por un administrador manda sobre la entrada de JMdict
        if (!found.has(row.lemma) || row.source === "approved") found.set(row.lemma, row);
      }
    }
  } catch (error) {
    console.error("No se pudo consultar el diccionario:", error); // la lectura sigue con lo que haya
  }
  return found;
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

const KUROMOJI_POS = {
  "動詞": "verb", "形容詞": "i_adjective", "副詞": "adverb", "助詞": "particle", "助動詞": "auxiliary",
  "接続詞": "conjunction", "感動詞": "interjection", "連体詞": "determiner", "接頭詞": "prefix",
  "記号": "symbol", "フィラー": "interjection"
};
const NOUN_DETAIL = { "固有名詞": "proper_noun", "数": "number", "代名詞": "pronoun", "形容動詞語幹": "na_adjective", "接尾": "suffix" };
const piecePos = (piece) => piece.pos === "名詞" ? NOUN_DETAIL[piece.pos_detail_1] || "noun" : KUROMOJI_POS[piece.pos] || "expression";
/* Piezas con contenido: de ellas sale el lema de la unidad */
const isContentPiece = (piece) => ["動詞", "形容詞", "名詞", "副詞", "連体詞", "感動詞", "接続詞"].includes(piece.pos) &&
  piece.pos_detail_1 !== "非自立" && piece.pos_detail_1 !== "接尾";
const pieceBase = (piece) => piece.basic_form && piece.basic_form !== "*" ? piece.basic_form : piece.surface_form;
const pieceReading = (piece) => piece.reading && piece.reading !== "*"
  ? piece.reading.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  : isKana(piece.surface_form) ? piece.surface_form : null;

/* Partículas habituales: una unidad que sea exactamente una de estas lo es siempre */
const PARTICLES = new Set(("は が を に で も と の か ね よ へ や な わ ぞ さ し ば て から まで より など って けど ので のに " +
  "でも だけ しか ばかり くらい ぐらい ほど こそ さえ かな よね とか には では にも とは へは").split(" "));

/* Analiza unas piezas seguidas como una sola unidad */
function unitOf(pieces) {
  const surface = pieces.map((piece) => piece.surface_form).join("");
  const content = pieces.find(isContentPiece) || pieces[0];
  const readings = pieces.map(pieceReading);
  const katakana = /^[ァ-ヶー]+$/.test(surface);
  return {
    surface, pieces,
    punct: PUNCTUATION.test(surface),
    pos: PUNCTUATION.test(surface) ? "punctuation" : PARTICLES.has(surface) ? "particle" : piecePos(content),
    basic: pieces.length === 1 || isContentPiece(pieces[0]) || pieces.some(isContentPiece) ? pieceBase(content) : surface,
    // Lectura de la unidad tal como está escrita (para el furigana); "" si kuromoji no la conoce
    reading: katakana ? surface : readings.every((r) => r !== null) ? readings.join("") : "",
    // Conjugación que da kuromoji: no se muestra todavía, se guarda para más adelante
    morph: pieces.map((piece) => [piece.surface_form, piece.pos, piece.conjugated_type, piece.conjugated_form, pieceBase(piece)])
  };
}

/* Convierte el formato segmentado en el que usa la app: a cada unidad le pone
   lema, lectura y tipo con kuromoji, sin IA. Resolución de cada unidad:
     1. la forma exacta está en el diccionario;
     2. su lema (forma de diccionario) está en el diccionario;
     3. la IA segmentó mal: se prueba a unirla con la siguiente o a dividirla;
     4. si no, se queda con su lema y sigue el camino normal de palabras sin resolver. */
async function fromSegmented(data, repairs) {
  const tokenizer = await loadTokenizer();
  const list = Array.isArray(data) ? data : data.sentences;

  /* kuromoji acierta más con la oración entera que con cada unidad suelta, así
     que se analiza la oración y sus piezas se reparten entre las unidades.
     Si una pieza cae entre dos unidades, esas se analizan por separado. */
  const analyse = (ja) => {
    const units = ja.split("|").map((unit) => unit.trim());
    const pieces = tokenizer.tokenize(units.join(""));
    const grouped = units.map(() => []);
    let unit = 0, unitEnd = units[0].length, offset = 0, clean = units.map(() => true);
    for (const piece of pieces) {
      const end = offset + piece.surface_form.length;
      while (unit < units.length - 1 && offset >= unitEnd) unitEnd += units[++unit].length;
      if (end > unitEnd) { // cruza la frontera: las unidades que toca se analizarán solas
        clean[unit] = false;
        for (let next = unit + 1, reach = unitEnd; next < units.length && reach < end; next++) {
          clean[next] = false;
          reach += units[next].length;
        }
      }
      grouped[unit].push(piece);
      offset = end;
    }
    return units.map((text, i) => unitOf(clean[i] && grouped[i].length ? grouped[i] : tokenizer.tokenize(text)));
  };
  const analysed = list.map((sentence) => analyse(sentence.ja));

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
      const pos = normalizePos(token.pos) || (PUNCTUATION.test(surface) ? "punctuation" : "expression");
      const lemma = isText(token.lemma) ? normalizeText(token.lemma) : surface;
      const reading = isText(token.reading) ? normalizeText(token.reading) : isKana(surface) ? surface : "";
      if (!normalizePos(token.pos)) repairs.push(`pos: ${surface} (${token.pos ?? "missing"})`);
      if (!isText(token.lemma)) repairs.push(`lemma missing: ${surface}`);
      if (!isText(token.reading) && pos !== "punctuation" && pos !== "symbol") repairs.push(`reading missing: ${surface}`);
      if (!UNCOUNTED_POS.has(pos) && !bankLookup(lemma, "")) pending.add(lemma);
      return { surface, lemma, reading, pos, ...(token.morph ? { morph: token.morph } : {}) };
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
    for (const token of sentence.tokens) {
      if (UNCOUNTED_POS.has(token.pos) && !given.has(token.lemma)) continue;
      const { entry, source, word, uk } = resolveWord(token.lemma, given.get(token.lemma), extra);
      if (source === "none") {
        token.pos = UNCOUNTED_POS.has(token.pos) ? token.pos : "expression";
        repairs.push(`dictionary entry missing: ${token.lemma}`);
      }
      if (!entry.reading) entry.reading = isKana(token.lemma) ? token.lemma : token.reading;
      if (!isKana(entry.reading || "")) continue; // sin lectura fiable no se puede enlazar: queda como texto

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
      sentence.dictionary[token.lemma] = entry;
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
  const { errors, text, flagged, repairs, partial } = await validateText(raw);
  if (errors.length) throw Object.assign(errors, { partial });
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
      if (UNCOUNTED_POS.has(token.pos) || !dictionary[token.lemma]) continue; // sin entrada no es una palabra enlazable
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
    requestId: origin.requestId || "", promptVersion: origin.promptVersion || PROMPT_VERSION, model: origin.model || "",
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

/* Vocabulario de un nivel: las palabras del banco (bank/bank.js) */
const levelVocabulary = (level) => [...BANK.words.values()].filter((word) => word.level === level);

const assumedLevels = () => LEVELS.slice(0, LEVELS.indexOf(meta.reading.assumed) + 1);

function knownLemmas() {
  const known = new Set();
  for (const level of assumedLevels()) {
    for (const word of levelVocabulary(level)) known.add(word.w);
  }
  // Lo que el usuario ha demostrado (leyendo o estudiando) manda sobre lo supuesto
  for (const word of userWords.values()) {
    if (KNOWN_STATUS.has(word.status) || word.studied && word.canReadKanji) known.add(word.lemma);
    else known.delete(word.lemma);
  }
  return known;
}

/* Una palabra escrita solo en kana (これ, する, コーヒー) no está en las listas
   por nivel: se da por conocida mientras el usuario no la marque al leer. */
function isKnownKey(key, known) {
  const mine = userWords.get(key);
  if (mine) return KNOWN_STATUS.has(mine.status) || !!(mine.studied && mine.canReadKanji);
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

async function startPlacement(level) {
  const index = LEVELS.indexOf(level);
  await BANK.loadUpTo(level);
  const pool = (lv) => shuffle(levelVocabulary(lv)
    .filter((word) => !word.kana && /\p{Script=Han}/u.test(word.w))
    .map((word) => ({ lemma: word.w, reading: word.r, en: word.en, es: word.es })));
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
  // Cómo se le escribe cada palabra a la IA:
  // - si casi siempre va en kana, en kana (有る -> ある), para que no use su kanji;
  // - si la escritura tiene varias lecturas, con la que el estudiante conoce: 角(かど).
  const label = (lemma, reading) => {
    const senses = BANK.byWriting.get(lemma) || [];
    if (senses.length && senses.every((word) => word.kana)) return senses[0].r;
    return senses.length > 1 && reading ? `${lemma}(${reading})` : lemma;
  };
  const readingOf = new Map([...userWords.values()].map((w) => [w.lemma, w.reading]));
  const all = [...new Set([...knownLemmas()].map((lemma) =>
    label(lemma, readingOf.get(lemma) || BANK.byWriting.get(lemma)?.[0].r)))];
  const params = {
    level: meta.reading.level, type, topic, length,
    known: all, assumedLevels: [],
    learning: [...userWords.values()].filter((w) => w.status === "learning")
      .map((w) => label(w.lemma, w.reading)).slice(0, 60)
  };
  if (all.length > PROMPT_WORD_LIMIT) {
    params.known = [...userWords.values()].filter((w) => KNOWN_STATUS.has(w.status))
      .map((w) => label(w.lemma, w.reading)).slice(0, PROMPT_WORD_LIMIT);
    params.assumedLevels = assumedLevels();
  }
  return params;
}

/* Versión del prompt: súbela cada vez que cambies su texto. Se guarda con cada
   generación para saber con qué versión salió cada error. */
const PROMPT_VERSION = "2026-10-08.1";

/* El prompt en sí. IMPORTANTE: supabase/functions/generate-text/index.ts lleva
   una copia de esta función (allí se genera el texto con la IA); si cambias
   una, cambia la otra. No usa nada de fuera salvo TOKEN_POS. */
function renderPrompt({ level, type, topic, length, known, assumedLevels, learning }) {
  const fresh = Math.round(length * 0.1);
  // Las IA cuentan mal "palabras": se da un mínimo de tokens y su equivalente en oraciones
  const minTokens = Math.round(length * 0.9), maxTokens = Math.round(length * 1.25);
  const minSentences = Math.ceil(length / 9), maxSentences = Math.ceil(length / 6.5);
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
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}- A word written with its reading in brackets, like 角(かど), has several readings: use it ONLY with that reading and its meaning (角(かど) is "corner", never つの "horn").

TEXT
- Type: ${type}. Topic: ${topic}.
- LENGTH (strict): across all sentences, the "tokens" arrays must contain between ${minTokens} and ${maxTokens} tokens that are not punctuation. That is about ${minSentences}-${maxSentences} sentences. Count the tokens before answering: a text with fewer than ${minTokens} is rejected. If you are short, continue the story with more sentences; do not pad with filler.
- Natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- Split it into short paragraphs (in a dialogue, one paragraph per speaker turn).
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use. Words that Japanese normally writes in kana must stay in kana (ある, いる, する, できる, ください, たくさん, かわいい, おいしい): never use rare kanji spellings such as 有る, 居る, 為る, 出来る, 下さい or 沢山.

OUTPUT
Return ONLY one JSON object (no explanations, no markdown), as compact JSON without indentation or line breaks, with exactly this structure (shown indented here only for readability):

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

/* Versión del prompt segmentado (formato nuevo): súbela al cambiar su texto. */
const SEGMENTED_VERSION = "2026-10-09.1-seg";

/* Prompt del formato nuevo: la IA solo escribe el texto separado en unidades
   con "|" y la traducción de cada oración. Lemas, lecturas y significados los
   pone la app (kuromoji + diccionario). IMPORTANTE: la función generate-text
   lleva una copia de esta función; si cambias una, cambia la otra. */
function renderPromptSeg({ level, type, topic, length, known, assumedLevels, learning }) {
  const fresh = Math.round(length * 0.1);
  const minUnits = Math.round(length * 0.9), maxUnits = Math.round(length * 1.25);
  const minSentences = Math.ceil(length / 9), maxSentences = Math.ceil(length / 6.5);
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
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}- A word written with its reading in brackets, like 角(かど), has several readings: use it ONLY with that reading and its meaning (角(かど) is "corner", never つの "horn"). Never write the brackets in the text.

TEXT
- Type: ${type}. Topic: ${topic}.
- LENGTH (strict): the text must contain between ${minUnits} and ${maxUnits} units that are not punctuation, in about ${minSentences}-${maxSentences} sentences. Count them before answering: a text with fewer than ${minUnits} is rejected. If you are short, continue the story with more sentences.
- Natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use. Words that Japanese normally writes in kana must stay in kana (ある, いる, する, できる, ください, たくさん, かわいい, おいしい): never use rare kanji spellings such as 有る, 居る, 為る, 出来る, 下さい or 沢山.

OUTPUT
Return ONLY one compact JSON object (no explanations, no markdown), with exactly these fields:

{"title":"毎朝のコーヒー","title_en":"Morning coffee","title_es":"El café de cada mañana","sentences":[
{"p":1,"ja":"私|は|毎朝|コーヒー|を|飲みます|。","en":"I drink coffee every morning.","es":"Bebo café todas las mañanas."},
{"p":1,"ja":"今日|は|新しい|店|で|買いました|が|、|あまり|おいしくなかった|です|。","en":"Today I bought it at a new shop, but it was not very good.","es":"Hoy lo compré en una tienda nueva, pero no estaba muy bueno."},
{"p":2,"ja":"「|明日|も|一緒に|行きません|か|」|と|友達|に|聞かれました|。","en":"\\"Won't you come with me tomorrow too?\\" my friend asked me.","es":"«¿No vienes conmigo mañana también?», me preguntó mi amigo."}]}

SEGMENTATION RULES
1. "ja" is the sentence with "|" between units. Removing every "|" must give the exact sentence: no spaces, nothing added, nothing dropped.
2. A conjugated verb or adjective is ONE unit together with its endings and auxiliaries (食べています, 高くなかった, 行きましょう, 聞かれました).
3. Particles are separate units (は, が, を, に, で, も, と, の, か, ね, よ). です and だ after a noun or adjective are their own unit.
4. Compound words stay as they appear in a dictionary (毎日, 食事中, 図書館, 一緒に).
5. Every punctuation mark and bracket is its own unit.
6. No empty units: never "||", and no "|" at the start or the end.
7. Do NOT give lemmas, readings, word translations or parts of speech. Only "p", "ja", "en" and "es".
8. "p" is the paragraph number, starting at 1 (in a dialogue, one paragraph per speaker turn). "en" and "es" are natural translations of the whole sentence.`;
}

// La app pide siempre el formato nuevo; el antiguo se sigue aceptando al pegar
const buildPrompt = (options) => renderPromptSeg(promptParams(options));

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
          <textarea id="promptAnswer" rows="6" spellcheck="false" autocomplete="off"
            autocapitalize="off" autocorrect="off"></textarea></label>
        <div class="inline-form paste-tools">
          <button id="promptPasteBtn" class="button button-outline" type="button">${t("Pegar del portapapeles")}</button>
          <span id="promptAnswerCount" class="helper"></span>
        </div>
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
    const save = async (content) => openText((await addText(content)).id);
    const fail = (error) => showPasteError(error, message, (json) => save(json).catch(fail));
    await save(raw).catch(fail);
  };
  bindPasteBox($("promptAnswer"), $("promptAnswerCount"), $("promptPasteBtn"));
}

/* ---------- Generar el texto con la IA (función generate-text de Supabase) ---------- */

/* Mensaje claro para cada fallo de la función */
function generationMessage(code, limit) {
  const messages = {
    unauthorized: t("Inicia sesión para generar textos con IA."),
    limit: t("Has llegado al límite de hoy ({n} textos). Mañana podrás crear más, o usa el modo manual.", { n: limit }),
    busy: t("Hoy ha habido demasiados intentos fallidos. Inténtalo mañana o usa el modo manual."),
    invalid: t("La IA no consiguió escribir un texto válido. No se ha descontado de tu límite; inténtalo de nuevo."),
    quota: t("La IA ha agotado su cuota por ahora. Inténtalo más tarde o usa el modo manual."),
    truncated: t("El texto salió demasiado largo y se cortó. Prueba con una longitud menor."),
    not_configured: t("La generación con IA aún no está configurada. Usa el modo manual.")
  };
  return messages[code] || t("La IA no pudo escribir el texto. Inténtalo de nuevo o usa el modo manual.");
}

async function requestText(params) {
  const { data, error } = await sb.functions.invoke("generate-text", { body: params });
  if (!error) return data;
  // Sin red, o la función no está desplegada todavía
  if (!error.context?.json) throw new Error(navigator.onLine ? generationMessage("not_configured") : t("No hay conexión. Inténtalo de nuevo cuando tengas internet."));
  const info = await error.context.json().catch(() => ({}));
  const code = error.context.status === 404 ? "not_configured" : info.error;
  throw Object.assign(new Error(generationMessage(code, info.limit)), { canRetry: !!info.canRetry });
}

/* Pide el texto a la IA. Si la respuesta falla (formato roto, error del
   servicio) la función lo indica y se repite la misma petición, hasta dos
   veces más. Solo cuenta para el límite del estudiante el texto que recibe. */
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
    const params = { ...promptParams(options), requestId: newId(), format: 2 };
    let answer = null;
    while (!answer) {
      try {
        answer = await requestText(params);
      } catch (error) {
        if (!error.canRetry) throw error;
        say(t("El primer intento no salió bien. Probando de nuevo…"));
      }
    }
    say(t("Analizando el texto… la primera vez se descarga el analizador de japonés (18 MB)."));
    openText((await addText(answer.text, "api", {
      requestId: params.requestId, promptVersion: answer.promptVersion, model: answer.model,
      topic: params.topic, level: params.level
    })).id);
  } catch (error) {
    if (!message.isConnected) return;
    if (Array.isArray(error)) showTextErrors(error, message); // texto roto
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

let reader = null; // { text, dictionary, canSkip, clicks: Map(clave -> clasificación), panel, startedAt }
// panel: lo que muestra el panel lateral: { kind: "word", s, t } | { kind: "sentence", s } | null

const CLASSES = {
  new: "Nueva", kanji: "Conocía la palabra, no el kanji", check: "La conocía, solo comprobaba"
};

async function openText(id) {
  const text = texts.find((x) => x.id === id);
  if (!text) return;
  const canSkip = !text.readAt && await skipsUsed() < MAX_SKIPS; // un texto ya leído no se salta
  const dictionary = {};
  for (const sentence of text.data.sentences) Object.assign(dictionary, sentence.dictionary);
  reader = { text, dictionary, canSkip, clicks: new Map(), panel: null, startedAt: Date.now() };
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
  const open = reader.panel;
  const words = sentence.tokens.map((token, tokenIndex) => {
    const key = tokenKey(token);
    if (!key) return escapeHTML(token.surface);

    const hasKanji = /\p{Script=Han}/u.test(token.surface);
    const unknown = !UNCOUNTED_POS.has(token.pos) && !isKnownKey(key, known);
    const furigana = hasKanji && (mode === "all" || mode === "unknown" && unknown);
    const mark = reader.clicks.get(key);
    const active = open?.kind === "word" && open.s === index && open.t === tokenIndex;
    return `<span class="tok${mark ? ` tok-${mark}` : ""}${active ? " active" : ""}" role="button" tabindex="0"
      data-s="${index}" data-t="${tokenIndex}">${
        furigana ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface)}</span>`;
  }).join("");
  // El botón 訳 enseña la traducción de la frase entera sin tener que tocar una palabra
  return `<span class="sent${open?.s === index ? " active" : ""}" data-sent="${index}">${words}</span><button
    class="sent-btn${open?.kind === "sentence" && open.s === index ? " on" : ""}" type="button" data-translate="${index}"
    title="${t("Traducción de la frase")}" aria-label="${t("Traducción de la frase")}" lang="ja">訳</button>`;
}

const FURIGANA_MODES = [["unknown", "Nuevas"], ["all", "Todas"], ["none", "Ninguna"]];

/* Panel junto al texto (debajo en móvil): la palabra tocada o la traducción de una frase */
function panelHTML() {
  const open = reader.panel;
  if (!open) return `<p class="helper">${t("Toca una palabra para ver su lectura y significado, o 訳 para traducir la frase entera.")}</p>`;

  const sentence = reader.text.data.sentences[open.s];
  const close = `<button class="icon-btn pop-close" type="button" data-panel-close
    title="${t("Cerrar")}" aria-label="${t("Cerrar")}">×</button>`;
  const translation = escapeHTML(lang === "es" ? sentence.es : sentence.en);

  if (open.kind === "sentence") {
    return `${close}
      <p class="panel-label">${t("Traducción de la frase")}</p>
      <p class="panel-jp" lang="ja">${escapeHTML(sentence.jp)}</p>
      <p class="panel-translation">${translation}</p>`;
  }

  const token = sentence.tokens[open.t];
  const entry = reader.dictionary[token.lemma];
  const meanings = lang === "es" && entry.meanings_es?.length ? entry.meanings_es : entry.meanings;
  const current = reader.clicks.get(tokenKey(token));
  return `${close}
    <div class="pop-word" lang="ja">${escapeHTML(token.surface)}</div>
    <div class="pop-reading" lang="ja">${escapeHTML(token.reading)}</div>
    ${token.lemma !== token.surface ? `<p class="pop-lemma">${t("Forma de diccionario")}:
      <span lang="ja">${escapeHTML(token.lemma)}（${escapeHTML(entry.reading)}）</span></p>` : ""}
    <p class="meaning">${escapeHTML(meanings.join(", "))}</p>
    <p class="helper">${escapeHTML(entry.pos || token.pos || "")}</p>
    <div class="pop-actions">
      ${Object.entries(CLASSES).map(([cls, label]) => `
        <button class="button pop-${cls}${current === cls ? " chosen" : ""}" type="button"
          data-class="${cls}">${t(label)}</button>`).join("")}
    </div>
    <button class="link-btn panel-more" type="button" data-translate="${open.s}">${t("Ver la traducción de la frase")}</button>`;
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
    <div class="reader${reader.panel ? " has-panel" : ""}">
      <div class="reader-head">
        <div>
          <h3 lang="ja">${escapeHTML(text.title)}</h3>
          <p class="helper">${escapeHTML(lang === "es" ? text.titleEs : text.titleEn)} ·
            ${escapeHTML(text.level)} · ${escapeHTML(text.topic)} · ${plural(wordCount(text.data), "palabra", "palabras")}</p>
        </div>
        <button id="readerCloseBtn" class="button button-quiet" type="button">${t("Salir")}</button>
      </div>
      <div class="reader-tools">
        <button id="reportBtn" class="link-btn report-btn" type="button">⚑ ${t("Reportar error")}</button>
        <span class="helper">Furigana</span>
        <div class="toggle-group" role="group" aria-label="Furigana">
          ${FURIGANA_MODES.map(([mode, label]) => `
            <button class="toggle${prefs.furigana === mode ? " on" : ""}" type="button"
              data-furigana="${mode}">${t(label)}</button>`).join("")}
        </div>
      </div>
      <div class="reader-body">
        <div class="reading-text" lang="ja">
          ${paragraphs.map((group) => `
          <p>${group.map(([sentence, index]) => sentenceHTML(sentence, index, known)).join("")}</p>`).join("")}
        </div>
        <aside id="readerPanel" class="reader-panel${reader.panel ? "" : " empty"}" aria-live="polite">${panelHTML()}</aside>
      </div>
      <div class="row-actions">
        ${canSkip ? `<button id="readerDiscardBtn" class="button button-outline" type="button">${t("Saltar: es muy difícil")}</button>` : ""}
        <button id="readerFinishBtn" class="button button-primary" type="button">${t("Terminar lectura")}</button>
      </div>
    </div>`;

  $("readerCloseBtn").onclick = () => { reader = null; renderRead(); };
  $("reportBtn").onclick = openReport;
  $("readerFinishBtn").onclick = () => finishReading(false);
  if (canSkip) $("readerDiscardBtn").onclick = () => finishReading(true);
}

/* ---------- Reportar un error del texto ---------- */

function openReport() {
  $("reportComment").value = "";
  $("reportMessage").textContent = sb && sync.user ? "" : t("Inicia sesión para enviar reportes.");
  $("reportSendBtn").disabled = !(sb && sync.user);
  $("reportDialog").showModal();
}

async function submitReport(event) {
  event.preventDefault();
  if (!reader) return $("reportDialog").close();
  $("reportSendBtn").disabled = true;
  const sent = await sendReport(reader.text, "user", $("reportCategory").value, $("reportComment").value.trim());
  $("reportSendBtn").disabled = false;
  if (!sent) {
    $("reportMessage").textContent = t("No se pudo enviar el reporte. Inténtalo de nuevo.");
    return;
  }
  $("reportDialog").close();
}

/* Vuelve a dibujar el lector sin mover el texto y deja a la vista lo que se tocó
   (en móvil el panel ocupa la parte baja de la pantalla) */
function refreshReader() {
  const scroll = window.scrollY;
  renderReader();
  window.scrollTo(0, scroll);
  const active = document.querySelector(".tok.active, .sent.active");
  const panel = $("readerPanel");
  if (!active || getComputedStyle(panel).position !== "fixed") return;
  const hidden = active.getBoundingClientRect().bottom - (panel.getBoundingClientRect().top - 12);
  if (hidden > 0) window.scrollBy({ top: hidden, behavior: "smooth" });
}

function closeWordPop() {
  if (reader) reader.panel = null;
}

function showPanel(panel) {
  reader.panel = panel;
  if (panel?.kind === "word") {
    const key = tokenKey(reader.text.data.sentences[panel.s].tokens[panel.t]);
    if (!reader.clicks.has(key)) reader.clicks.set(key, "looked");
  }
  refreshReader();
}

/* New: no la conocía. Kanji: conocía la palabra pero no su escritura.
   Check: la conocía; queda como posiblemente conocida hasta la evaluación. */
async function classifyWord(cls) {
  const { s, t: index } = reader.panel;
  const token = reader.text.data.sentences[s].tokens[index];
  const key = tokenKey(token);
  const mine = userWords.get(key) || blankUserWord(token.lemma, reader.dictionary[token.lemma].reading);
  if (reader.clicks.get(key) === "looked" || !reader.clicks.has(key)) mine.lookups++;
  mine.lastSeen = Date.now();

  if (cls === "new") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: false });
  if (cls === "kanji") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: true });
  if (cls === "check" && mine.status !== "mastered") mine.status = "pre_known";

  reader.clicks.set(key, cls);
  await saveUserWord(mine);
  if (reader) refreshReader(); // el panel sigue abierto, con la opción elegida marcada
}

/* ---------- Fin de la lectura ---------- */

async function finishReading(discarded) {
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
    if (!reader) return;
    const pick = (selector) => event.target.closest(selector);
    const token = pick(".tok"), translate = pick("[data-translate]");
    if (token) {
      const panel = { kind: "word", s: Number(token.dataset.s), t: Number(token.dataset.t) };
      const same = reader.panel?.kind === "word" && reader.panel.s === panel.s && reader.panel.t === panel.t;
      return showPanel(same ? null : panel); // tocar otra vez la misma palabra cierra el panel
    }
    if (translate) {
      const s = Number(translate.dataset.translate);
      const same = reader.panel?.kind === "sentence" && reader.panel.s === s;
      return showPanel(same ? null : { kind: "sentence", s });
    }
    if (pick("[data-panel-close]")) return showPanel(null);
    if (pick("[data-class]")) return classifyWord(pick("[data-class]").dataset.class);
    if (pick("[data-furigana]")) {
      prefs.furigana = $("furiganaSelect").value = pick("[data-furigana]").dataset.furigana;
      saveLocal("kanji-prefs", prefs);
      refreshReader();
    }
  });
  area.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".tok")) {
      event.preventDefault();
      event.target.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && reader?.panel) showPanel(null);
  });

  $("reportForm").addEventListener("submit", submitReport);
  $("reportCancelBtn").addEventListener("click", () => $("reportDialog").close());

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

/* Una palabra del banco que llega solo como progreso: su significado sale del banco */
function ensureWordEntry(mine) {
  if (words.has(mine.id)) return null;
  const word = BANK.words.get(mine.id);
  if (!word) return null;
  const entry = { id: mine.id, lemma: mine.lemma, reading: mine.reading, meanings: word.en,
    meaningsEs: word.es, pos: "", source: "jmdict", updatedAt: Date.now() };
  words.set(entry.id, entry);
  return entry;
}

/* Campos de repaso espaciado, iguales en palabras y kanjis */
const srsToRow = (record) => ({
  studied: !!record.studied, repetitions: whole(record.repetitions), interval_days: whole(record.interval),
  ease: Number(record.ease) || 2.5,
  next_review: /^\d{4}-\d{2}-\d{2}$/.test(record.nextReview || "") ? record.nextReview : null,
  last_reviewed: record.lastReviewed ? isoOf(Date.parse(record.lastReviewed)) : null,
  correct_count: whole(record.correctCount), incorrect_count: whole(record.incorrectCount),
  streak_days: whole(record.streakDays), last_correct_day: record.lastCorrectDay || null
});
const srsFromRow = (row) => ({
  studied: !!row.studied, repetitions: row.repetitions || 0, interval: row.interval_days || 0,
  ease: row.ease || 2.5, nextReview: row.next_review || today(), lastReviewed: row.last_reviewed || null,
  correctCount: row.correct_count || 0, incorrectCount: row.incorrect_count || 0,
  streakDays: row.streak_days || 0, lastCorrectDay: row.last_correct_day || ""
});

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
      firstSeen: msOf(row.first_seen), lastSeen: msOf(row.last_seen), updatedAt: stamp,
      ...srsFromRow(row)
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

  // Progreso por kanji
  rows = await fetchChanged("user_kanji", "id", userId, cursors.user_kanji);
  const newerKanji = [];
  for (const row of rows) {
    const stamp = Number(row.client_updated_at);
    sync.pushed.kanji[row.id] = String(stamp);
    const mine = userKanji.get(row.id);
    if (mine && mine.updatedAt >= stamp) continue;
    const record = {
      id: row.id, status: row.status, knowsMeaning: row.knows_meaning, canWrite: row.can_write,
      writes: row.writes || 0, firstSeen: msOf(row.first_seen), lastSeen: msOf(row.last_seen),
      updatedAt: stamp, ...srsFromRow(row)
    };
    userKanji.set(record.id, record);
    newerKanji.push(record);
  }
  if (newerKanji.length) { await putRecords("userKanji", newerKanji); changed = true; }
  last(rows, "user_kanji");

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

  if (changed) refreshReadingViews();
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
    client_updated_at: Math.round(word.updatedAt), ...srsToRow(word)
  })), changed.map((word) => [word.id, String(word.updatedAt)]), pushed.words);

  // Progreso por kanji
  const kanjiChanged = [...userKanji.values()].filter((k) => pushed.kanji[k.id] !== String(k.updatedAt));
  await pushRows("user_kanji", "user_id,id", kanjiChanged.map((k) => ({
    user_id: userId, id: k.id, status: k.status || "unknown",
    knows_meaning: !!k.knowsMeaning, can_write: !!k.canWrite, writes: whole(k.writes),
    first_seen: isoOf(k.firstSeen), last_seen: isoOf(k.lastSeen),
    client_updated_at: Math.round(k.updatedAt), ...srsToRow(k)
  })), kanjiChanged.map((k) => [k.id, String(k.updatedAt)]), pushed.kanji);

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
  renderAll();
  if (document.body.dataset.view === "read" && !reader && !placement && !evaluation) renderRead();
}

