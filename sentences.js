/* =========================================
   KANJI LEARNING APP - sentences.js
   Frases de ejemplo: las del usuario (salen de sus textos), las comunes de la
   app (bank/sentences/<nivel>.json) y su uso al repasar.
   Las reglas (qué frase vale, cuál se elige) están en sentences-core.js; aquí
   solo va lo que toca al navegador. Se carga después de study.js.

   Almacenes de IndexedDB:
     sentences      frases del usuario, con la forma de sentences-core.js más
                    { updatedAt, local }. local: su texto no se sube (texto
                    pegado), así que la frase tampoco.
     sentenceStats  { id, shown, lastShown, updatedAt }: veces que se ha enseñado
                    cada frase, sea del usuario o común.
   Las frases se pueden reconstruir siempre a partir de los textos.
   ========================================= */

let userSentences = new Map(); // id -> frase del usuario
let sentenceStats = new Map(); // id -> { id, shown, lastShown, updatedAt }

/* =========================================
   1. ALMACENAMIENTO
   ========================================= */

async function loadSentenceData() {
  userSentences = new Map((await getAll("sentences")).map((s) => [s.id, s]));
  sentenceStats = new Map((await getAll("sentenceStats")).map((s) => [s.id, s]));
}

/* Anota que una frase se ha enseñado en un repaso */
async function markSentenceShown(id) {
  const stat = sentenceStats.get(id) || { id, shown: 0, lastShown: 0 };
  stat.shown++;
  stat.lastShown = stat.updatedAt = Date.now();
  sentenceStats.set(id, stat);
  await putRecords("sentenceStats", [stat]);
  scheduleSync();
}

/* =========================================
   2. FRASES DE LOS TEXTOS DEL USUARIO
   -----------------------------------------
   Cada texto guardado (escrito por la IA, de la comunidad o pegado) deja sus
   frases aquí. Ya vienen analizadas en text.data.sentences, así que no hace
   falta kuromoji. Vale una frase de 4 a 20 unidades con todas sus palabras
   resueltas y al menos una que se pueda preguntar.
   Al guardar un texto solo se procesa ese texto; se rehace todo únicamente
   cuando cambia SENTENCE_INDEX_VERSION.
   ========================================= */

const SENTENCE_INDEX_VERSION = 1; // súbela si cambian las reglas: rehace las frases de todos los textos
const USER_SENTENCE_UNITS = [4, 20];

/* Lo que se sabe de una palabra por su clave: del banco o del diccionario del usuario */
const sentenceWordOf = (key) => {
  const word = BANK.words.get(key);
  return word ? { level: word.level, kana: word.kana } : words.has(key) ? { level: null, kana: false } : null;
};
/* Lecturas de kanji que ejercita una palabra: las del banco o, fuera de él, repartidas con sus kanjis */
const sentenceTagsOf = (key) => {
  if (BANK.readings[key]) return unpackTags(BANK.readings[key]);
  const [lemma, reading] = key.split("|");
  return alignReading(lemma, reading, (c) => BANK.kanji.get(c)) || [];
};

/* Frases válidas de un texto (sin guardar nada) */
function sentencesOfText(text) {
  const dictionary = {};
  for (const sentence of text.data.sentences) Object.assign(dictionary, sentence.dictionary);
  const list = [];
  text.data.sentences.forEach((sentence, index) => {
    const tokens = sentence.tokens.map((token) => {
      if (UNCOUNTED_POS.has(token.pos)) return { ...token, key: "" };
      // La palabra que anotó el texto; si la escritura tiene varias lecturas, la que suena en la frase
      // La palabra que anotó el texto: la de la unidad (textos nuevos) o la del diccionario por lema
      const entry = dictionary[token.lemma];
      const noted = token.key || (entry && isKana(entry.reading || "") ? wordKey(token.lemma, entry.reading) : "");
      return { ...token, key: resolveKey(token, (form) => BANK.sensesOf(form), noted) };
    });
    const built = buildSentence({
      id: `${text.id}:${sentence.id ?? index + 1}`, tokens, en: sentence.en || "", es: sentence.es || "",
      source: text.source === "paste" ? "article" : "text", sourceId: text.id, attribution: "",
      wordOf: sentenceWordOf, tagsOf: sentenceTagsOf, fallbackLevel: text.level || "N5"
    });
    const [minUnits, maxUnits] = USER_SENTENCE_UNITS;
    if (validateSentence(built, { minUnits, maxUnits, wordOf: sentenceWordOf }).ok) list.push(built);
  });
  return list;
}

/* Hace falta el banco entero (para el nivel de cada palabra) y sus lecturas de kanji */
const ensureSentenceData = () => Promise.all([BANK.loadUpTo("N1"), BANK.loadReadings()]);

/* Guarda las frases de unos textos, sustituyendo las que tuvieran. Una frase
   que no ha cambiado conserva su fecha, para no volver a subirla. */
async function indexTexts(list) {
  if (!list.length) return;
  await ensureSentenceData();
  const saved = [], removed = [];
  for (const text of list) {
    const fresh = new Map(sentencesOfText(text).map((sentence) => [sentence.id, sentence]));
    for (const old of userSentences.values()) {
      if (old.sourceId === text.id && !fresh.has(old.id)) { userSentences.delete(old.id); removed.push(old.id); }
    }
    for (const sentence of fresh.values()) {
      const old = userSentences.get(sentence.id);
      const { updatedAt, local, ...before } = old || {};
      if (old && !!local === !!text.local && JSON.stringify(before) === JSON.stringify(sentence)) continue;
      const record = { ...sentence, updatedAt: Date.now(), ...(text.local ? { local: true } : {}) };
      userSentences.set(record.id, record);
      saved.push(record);
    }
  }
  if (!saved.length && !removed.length) return;
  await putRecords("sentences", saved, removed);
  forgetSentenceIndex();
  scheduleSync();
}

/* Nunca debe impedir que un texto se guarde o se lea */
const indexTextsQuietly = (list) => indexTexts(list)
  .catch((error) => console.error("No se pudieron sacar las frases del texto:", error));

/* Al borrar u ocultar un texto, sus frases se van con él */
async function dropTextSentences(textId) {
  const ids = [...userSentences.values()].filter((sentence) => sentence.sourceId === textId).map((sentence) => sentence.id);
  if (!ids.length) return;
  ids.forEach((id) => userSentences.delete(id));
  await putRecords("sentences", [], ids);
  forgetSentenceIndex();
}

/* Al abrir la app: si cambiaron las reglas (o es la primera vez), se rehacen
   las frases de todos los textos. Va en segundo plano. */
async function rebuildSentencesIfNeeded() {
  if (prefs.sentenceIndex === SENTENCE_INDEX_VERSION) return;
  const visible = texts.filter((text) => !text.hiddenAt);
  if (visible.length) {
    await indexTexts(visible);
    // Frases de textos que ya no están
    const alive = new Set(visible.map((text) => text.id));
    for (const id of new Set([...userSentences.values()].map((sentence) => sentence.sourceId))) {
      if (!alive.has(id)) await dropTextSentences(id);
    }
  }
  prefs.sentenceIndex = SENTENCE_INDEX_VERSION;
  saveLocal("kanji-prefs", prefs);
}

/* =========================================
   3. FRASES COMUNES Y BÚSQUEDA POR PALABRA
   -----------------------------------------
   Las frases comunes van en bank/sentences/<nivel>.json y se descargan por
   nivel cuando hacen falta (el service worker las guarda al primer uso). Ya
   traen sus unidades analizadas: para enseñarlas no hace falta kuromoji.
   ========================================= */

const staticSentences = new Map(); // nivel -> frases comunes ya descargadas
const staticLoading = {};          // nivel -> promesa
let sentenceIndex = null;          // id de palabra -> frases (se calcula una vez y se guarda)
let kanjiSentenceIndex = null;     // kanji -> [{ sentence, target, char, sound, sounds, tag }]

/* Descarga las frases comunes de un nivel (una sola vez). Si el archivo no
   existe todavía o no hay conexión, ese nivel se queda sin frases comunes. */
function loadStaticSentences(level) {
  if (!BANK.LEVELS.includes(level)) return Promise.resolve();
  return staticLoading[level] ??= fetch(`bank/sentences/${level.toLowerCase()}.json`)
    .then((response) => response.ok ? response.json() : [])
    .then((list) => {
      staticSentences.set(level, Array.isArray(list) ? list : []);
      forgetSentenceIndex();
    })
    .catch(() => { delete staticLoading[level]; }); // sin conexión: se reintenta la próxima vez
}

/* Frases para estas palabras: carga las comunes de sus niveles */
const ensureSentences = (levels) => Promise.all([...new Set(levels)].map(loadStaticSentences));

function forgetSentenceIndex() {
  sentenceIndex = null;
  kanjiSentenceIndex = null;
}

/* Todas las frases que sirven para preguntar una palabra */
function sentencesFor(wordId) {
  if (!sentenceIndex) {
    sentenceIndex = new Map();
    const add = (sentence) => {
      for (const target of sentence.targets || []) {
        if (!sentenceIndex.has(target)) sentenceIndex.set(target, []);
        sentenceIndex.get(target).push(sentence);
      }
    };
    for (const sentence of userSentences.values()) add(sentence);
    for (const list of staticSentences.values()) list.forEach(add);
  }
  return sentenceIndex.get(wordId) || [];
}

/* Dónde sale un kanji dentro de las palabras preguntables de las frases y cómo
   suena allí (kanjiSounds, con las lecturas de bank/readings.js: hace falta
   BANK.loadReadings()). Solo vale si el kanji tiene su propia lectura: en
   今日 (きょう) no se puede separar la de 今. */
function kanjiSentencesFor(c) {
  // Se rehace también cuando llegan las lecturas: sin ellas el reparto es peor
  if (!kanjiSentenceIndex || kanjiSentenceIndex.readings !== BANK.readings) {
    kanjiSentenceIndex = Object.assign(new Map(), { readings: BANK.readings });
    const add = (sentence) => sentence.tokens.forEach((token, target) => {
      if (!token.key || !(sentence.targets || []).includes(token.key)) return;
      const [lemma, reading] = token.key.split("|");
      if (!readingMatches(token, lemma, reading)) return;
      const tags = sentenceTagsOf(token.key);
      const sounds = kanjiSounds(token.surface, token.reading, tags, (k) => BANK.kanji.get(k));
      if (!sounds) return;
      const chars = [...token.surface];
      chars.forEach((kanji, char) => {
        if (!sounds[char] || sounds[char + 1] === null || chars.indexOf(kanji) !== char) return;
        const tag = tags.find((tag) => tag.split("|")[0] === kanji);
        if (!tag) return;
        if (!kanjiSentenceIndex.has(kanji)) kanjiSentenceIndex.set(kanji, []);
        kanjiSentenceIndex.get(kanji).push({ sentence, target, char, sound: sounds[char], sounds, tag });
      });
    });
    for (const sentence of userSentences.values()) add(sentence);
    for (const list of staticSentences.values()) list.forEach(add);
  }
  return kanjiSentenceIndex.get(c) || [];
}

/* La frase para una tarjeta (palabra o kanji) según lo que el usuario conoce, o null */
function sentenceForCard(card) {
  const candidates = card.kind === "kanji" ? kanjiSentencesFor(card.id) : sentencesFor(card.id);
  if (!candidates.length) return null;
  const known = knownLemmas();
  const state = {
    candidates,
    isKnown: (key) => isKnownKey(key, known),
    statsOf: (id) => sentenceStats.get(id)
  };
  return card.kind === "kanji" ? chooseKanjiSentence(state) : chooseSentence({ id: card.id }, state);
}

/* =========================================
   4. LA FRASE EN PANTALLA
   ========================================= */

const sentenceTranslation = (sentence) => (lang === "es" ? sentence.es || sentence.en : sentence.en || sentence.es) || "";

/* La frase con sus unidades. options:
     target    índice de la unidad preguntada: va marcada y nunca lleva furigana
     extra     índice de la palabra desconocida de más: siempre con furigana y se puede tocar
     furigana  "all" | "unknown" | "none" para las demás (por defecto, el ajuste de lectura)
     reveal    true al enseñar la respuesta: furigana en todo, también en la preguntada
     char, sounds  al preguntar un kanji suelto: solo ese carácter de la unidad
               va marcado; el resto de la unidad sigue el ajuste de furigana */
function sentenceLineHTML(sentence, { target = -1, extra = -1, furigana = prefs.furigana, reveal = false, char = -1, sounds = null } = {}) {
  const known = knownLemmas();
  return sentence.tokens.map((token, index) => {
    // Furigana solo en palabras resueltas: kuromoji lee mal números y contadores (七時 -> ななじ)
    const hasKanji = /\p{Script=Han}/u.test(token.surface) && token.reading && !!token.key;
    const unknown = !!token.key && !UNCOUNTED_POS.has(token.pos) && !isKnownKey(token.key, known);
    const ruby = hasKanji && (reveal || index === extra || furigana === "all" || furigana === "unknown" && unknown);
    if (index === target && char >= 0) {
      return `<span class="sent-unit">${unitCharsHTML(token.surface, sounds, char, ruby, reveal)}</span>`;
    }
    if (index === target) {
      return `<mark class="sent-target">${reveal && hasKanji ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface)}</mark>`;
    }
    const html = ruby ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface);
    return index === extra
      ? `<span class="sent-extra" role="button" tabindex="0" data-sent-extra="${index}">${html}</span>` : html;
  }).join("");
}

/* Una unidad carácter a carácter (sounds, de kanjiSounds): solo char va marcado
   y su furigana sale únicamente al enseñar la respuesta; los demás kanjis la
   llevan si ruby. Los kanjis que se leen juntos (null) van con el anterior. */
function unitCharsHTML(surface, sounds, char, ruby, reveal) {
  const chars = [...surface];
  let html = "";
  for (let i = 0; i < chars.length; i++) {
    let end = i + 1;
    while (sounds[end] === null) end++;
    const text = escapeHTML(chars.slice(i, end).join(""));
    const part = sounds[i] && (i === char ? reveal : ruby) ? `<ruby>${text}<rt>${escapeHTML(sounds[i])}</rt></ruby>` : text;
    html += i === char ? `<mark class="sent-target">${part}</mark>` : part;
    i = end - 1;
  }
  return html;
}

/* Lo que se sabe de una unidad para explicarla al tocarla: lectura y significado */
function tokenGlossHTML(token) {
  const entry = token.key ? wordEntry(token.key) : null;
  const meaning = entry ? gloss(entry, 3) : "";
  return `<span lang="ja">${escapeHTML(token.lemma)}（${escapeHTML(entry?.r || token.reading)}）</span>${meaning ? ` ${escapeHTML(meaning)}` : ""}`;
}

/* Etiquetas "kanji|lectura" de la frase que son de una palabra (por su escritura) */
const wordTags = (sentence, writing) =>
  (sentence.kanjiReadings || []).filter((tag) => [...tag.split("|")[0]].every((c) => writing.includes(c)));

/* Estadísticas: lecturas de kanji acertadas dentro de una frase.
   meta.practice = { "学|がく": { n: veces, last: día } }. Se guarda en este
   dispositivo, como las preferencias. */
function renderKanjiReadings() {
  const list = Object.entries(meta.practice || {}).sort((a, b) => b[1].last.localeCompare(a[1].last) || b[1].n - a[1].n);
  $("statKanjiReadings").textContent = list.length;
  $("kanjiReadingList").innerHTML = list.length
    ? list.slice(0, 60).map(([tag, entry]) => {
        const [kanji, reading] = tag.split("|");
        const tip = `${kanji} ${reading}: ${plural(entry.n, "acierto", "aciertos")}`;
        return `<li title="${escapeHTML(tip)}"><strong lang="ja">${escapeHTML(kanji)}</strong>
          <span lang="ja">${escapeHTML(reading)}</span>${entry.n > 1 ? `<span>×${entry.n}</span>` : ""}</li>`;
      }).join("")
    : `<li><span>${t("Aquí verás las lecturas de kanji que aciertes al repasar «En una frase».")}</span></li>`;
}

/* De dónde es la frase: las de Tatoeba llevan su autor y su licencia */
function sentenceCreditHTML(sentence) {
  return sentence.attribution ? `<p class="helper sent-credit">${escapeHTML(sentence.attribution)}</p>` : "";
}

/* =========================================
   5. SINCRONIZACIÓN (tabla user_sentences de Supabase)
   -----------------------------------------
   Se suben las frases de los textos que también se suben y el contador de
   cada frase enseñada. Si la tabla aún no existe (falta volver a ejecutar
   supabase/schema.sql) no pasa nada: se queda todo en el dispositivo.
   ========================================= */

const sentencePrint = (id) => `${userSentences.get(id)?.updatedAt || 0}:${sentenceStats.get(id)?.shown || 0}`;
const tableMissing = (error) => ["PGRST205", "42P01"].includes(error?.code);

async function pullSentences(userId) {
  const cursors = sync.config.cursors, pushed = sync.pushed.sentences ??= {};
  let rows;
  try {
    rows = await fetchChanged("user_sentences", "id", userId, cursors.user_sentences);
  } catch (error) {
    if (tableMissing(error)) return;
    throw error;
  }
  const saved = [], removed = [], stats = [];
  for (const row of rows) {
    const mine = userSentences.get(row.id);
    if (row.deleted_at) {
      pushed[row.id] = "d";
      if (mine) { userSentences.delete(row.id); removed.push(row.id); }
      continue;
    }
    const stamp = Number(row.client_updated_at);
    if (row.data && (!mine || (mine.updatedAt || 0) < stamp)) {
      const sentence = { ...row.data, id: row.id, updatedAt: stamp };
      userSentences.set(row.id, sentence);
      saved.push(sentence);
    }
    // Del contador gana el mayor: cada dispositivo solo suma
    const stat = sentenceStats.get(row.id) || { id: row.id, shown: 0, lastShown: 0 };
    const lastShown = msOf(row.last_shown) || 0;
    if (row.shown > stat.shown || lastShown > stat.lastShown) {
      stat.shown = Math.max(stat.shown, row.shown);
      stat.lastShown = Math.max(stat.lastShown, lastShown);
      stat.updatedAt = Date.now();
      sentenceStats.set(row.id, stat);
      stats.push(stat);
    }
    pushed[row.id] = `${row.data ? stamp : 0}:${row.shown}`;
  }
  if (saved.length || removed.length) {
    await putRecords("sentences", saved, removed);
    forgetSentenceIndex();
  }
  if (stats.length) await putRecords("sentenceStats", stats);
  if (rows.length) cursors.user_sentences = rows[rows.length - 1].updated_at;
}

async function pushSentences(userId) {
  const pushed = sync.pushed.sentences ??= {};
  const ids = new Set([
    ...[...userSentences.values()].filter((sentence) => !sentence.local).map((sentence) => sentence.id),
    ...[...sentenceStats.keys()].filter((id) => !userSentences.get(id)?.local)
  ]);
  const changed = [...ids].filter((id) => pushed[id] !== sentencePrint(id));
  // Frases que ya no existen aquí porque se borró su texto
  const gone = Object.keys(pushed).filter((id) => pushed[id] !== "d" && !pushed[id].startsWith("0:") && !userSentences.has(id));
  try {
    await pushRows("user_sentences", "user_id,id", changed.map((id) => {
      const sentence = userSentences.get(id), stat = sentenceStats.get(id);
      const { updatedAt, local, ...data } = sentence || {};
      return {
        user_id: userId, id, text_id: sentence?.sourceId || null, data: sentence ? data : null,
        shown: whole(stat?.shown), last_shown: isoOf(stat?.lastShown),
        client_updated_at: Math.round(Math.max(updatedAt || 0, stat?.updatedAt || 0)), deleted_at: null
      };
    }), changed.map((id) => [id, sentencePrint(id)]), pushed);
    for (let i = 0; i < gone.length; i += 200) {
      const batch = gone.slice(i, i + 200);
      const { error } = await sb.from("user_sentences").update({ deleted_at: new Date().toISOString() })
        .eq("user_id", userId).in("id", batch);
      if (error) throw error;
      for (const id of batch) pushed[id] = "d";
    }
  } catch (error) {
    if (!tableMissing(error)) throw error;
    console.warn("Falta la tabla user_sentences: ejecuta supabase/schema.sql.");
  }
}
