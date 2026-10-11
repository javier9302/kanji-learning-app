/* =========================================
   KANJI LEARNING APP - dictionary.js
   Diccionario: buscar una palabra por su escritura, su lectura (en kana o en
   romaji) o su significado (español o inglés).
   Se carga después de study.js y antes de app.js.

   Un resultado tiene siempre la misma forma, venga de donde venga:
     { id, w, r, en, es, alt, level, rank, source: "bank" | "dict" }
   Los homógrafos son resultados distintos: 角 かど, 角 かく y 角 つの.

   Orden: 1.º escritura o lectura exacta, 2.º empieza por lo buscado,
   3.º el significado coincide, 4.º la escritura lo contiene. A igualdad,
   la palabra más frecuente (BANK.frequency) va primero.
   ========================================= */

const DICT_LIMIT = 50;

/* ---------- 1. Búsqueda (sin DOM: también la usan las pruebas) ---------- */

const dictHasJapanese = (text) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
const dictIsKana = (text) => /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(text);
const dictHiragana = (text) => String(text).normalize("NFKC")
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[.\-\s・~]/g, "");
/* Para comparar significados: minúsculas y sin acentos (cafe = café) */
const dictFold = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/* "(someone else's) older brother (formal)" -> "older brother";  "to drink" -> "drink" */
const dictGloss = (text) => dictFold(text).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/^to /, "");

/* Lo que escribió el usuario, ya interpretado:
     writing  texto japonés tal cual (kanji o kana)
     kana     su lectura en hiragana, si lo escrito es kana o romaji válido
     meaning  texto para buscar en los significados (solo si no es japonés)
   toHiragana convierte romaji (WanaKana en la app). */
function parseDictQuery(text, toHiragana = (value) => value) {
  const raw = String(text ?? "").normalize("NFKC").trim();
  if (!raw) return null;
  if (dictHasJapanese(raw)) {
    const writing = raw.replace(/\s+/g, "");
    return { raw, writing, kana: dictIsKana(writing) ? dictHiragana(writing) : "", meaning: "" };
  }
  const kana = dictHiragana(toHiragana(raw.toLowerCase()));
  return { raw, writing: "", kana: dictIsKana(kana) ? kana : "", meaning: dictGloss(raw) };
}

/* Cómo coincide una entrada con la búsqueda: [nivel, detalle] (menor = mejor) o null.
   language: idioma de la interfaz; el otro también se acepta, pero después. */
function dictMatch(entry, query, language = "es") {
  const reading = dictHiragana(entry.r);
  const readings = [reading, ...(entry.alt || []).map(dictHiragana)];
  if (query.writing && entry.w === query.writing) return [0, 0];
  if (query.kana && readings.includes(query.kana)) return [0, readings[0] === query.kana ? 1 : 2];
  if (query.writing && entry.w.startsWith(query.writing)) return [1, entry.w.length];
  if (query.kana && reading.startsWith(query.kana)) return [1, reading.length];

  if (query.meaning && query.meaning.length > 1) {
    const mine = language === "es" ? [entry.es, entry.en] : [entry.en, entry.es];
    let best = null;
    mine.forEach((glosses, other) => {
      (glosses || []).forEach((text, position) => {
        const gloss = dictGloss(text);
        // 0 = el significado entero, 1 = una palabra suya, 2 = solo un trozo
        const kind = gloss === query.meaning ? 0
          : new RegExp(`(^|[^\\p{L}])${query.meaning.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(gloss) ? 1
          : gloss.includes(query.meaning) ? 2 : -1;
        if (kind < 0) return;
        const score = kind * 100 + other * 10 + Math.min(position, 9);
        if (best === null || score < best) best = score;
      });
    });
    if (best !== null) return [2, best];
  }
  if (query.writing && !query.kana && entry.w.includes(query.writing)) return [3, entry.w.length];
  return null;
}

/* Ordena y recorta. entries: resultados con la forma común (ver arriba). */
function rankResults(entries, query, language = "es", limit = DICT_LIMIT) {
  const LEVEL = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
  const seen = new Set(), list = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue; // el banco manda sobre el diccionario general
    const match = dictMatch(entry, query, language);
    if (!match) continue;
    seen.add(entry.id);
    list.push({ entry, match });
  }
  const rank = (entry) => entry.rank || Infinity;
  list.sort((a, b) =>
    a.match[0] - b.match[0] ||
    // En el significado manda lo bien que coincide; en lo demás, la frecuencia
    (a.match[0] === 2 ? a.match[1] - b.match[1] : 0) ||
    rank(a.entry) - rank(b.entry) ||
    (a.entry.source === "bank" ? 0 : 1) - (b.entry.source === "bank" ? 0 : 1) ||
    (LEVEL[a.entry.level] ?? 9) - (LEVEL[b.entry.level] ?? 9) ||
    a.match[1] - b.match[1] ||
    a.entry.w.length - b.entry.w.length);
  return list.slice(0, limit).map((item) => item.entry);
}

/* Una palabra del banco con la forma común de los resultados */
const dictBankEntry = (word, frequency = {}) => ({
  id: word.id, w: word.w, r: word.r, en: word.en, es: word.es, alt: word.alt || [],
  level: word.level, rank: frequency[word.id] || 0, kana: !!word.kana, source: "bank"
});

/* Ventaja de una consulta reciente: 1 el día que se buscó, 0 pasados `days` días */
function lookupRecency(lastSeen, now, days) {
  if (!lastSeen || !(days > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - (now - lastSeen) / (days * 86400000)));
}

/* Palabras que se le piden a la IA para sus textos: las que el usuario está
   aprendiendo. Primero las que buscó en el diccionario y aún no sabe (la más
   reciente antes) y después el resto, en su orden. Nunca una ya conocida. */
function promptLearning(records, limit = 60) {
  const KNOWN = new Set(["mastered", "pre_known"]);
  const searched = records
    .filter((w) => w.origin === "diccionario" && !KNOWN.has(w.status) && !(w.studied && w.canReadKanji))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const taken = new Set(searched);
  const learning = records.filter((w) => w.status === "learning" && !taken.has(w));
  return [...searched, ...learning].slice(0, limit);
}

/* ---------- 2. Vista ---------- */

let dictState = { text: "", results: [], open: "", remote: "" }; // open: id del resultado desplegado
// remote: cómo fue la consulta al diccionario general: "" | "loading" | "ok" | "guest" | "offline" | "error"
let dictTimer = null;
let dictSearchId = 0; // para descartar la respuesta de una búsqueda anterior

const dictToHiragana = (text) => window.wanakana?.toHiragana ? window.wanakana.toHiragana(text) : text;

/* Las palabras del banco ya cargadas, con la forma común */
const searchBank = () => [...BANK.words.values()].map((word) => dictBankEntry(word, BANK.frequency));

const dictKatakana = (text) => text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const dictRemoteEntry = (row) => ({
  id: wordKey(row.lemma, row.reading || row.lemma), w: row.lemma, r: row.reading || row.lemma,
  en: row.meanings || [], es: row.meanings_es || [], alt: [], level: null, rank: 0, kana: !!row.uk, source: "dict"
});

/* Diccionario general (tabla dictionary de Supabase, unas 29.000 palabras de
   JMdict que no están en el banco). Solo con sesión y con conexión.
   Devuelve { entries, state }. */
async function searchRemote(query) {
  if (!sb || !sync.user) return { entries: [], state: "guest" };
  if (!navigator.onLine) return { entries: [], state: "offline" };
  const fields = "lemma, reading, meanings, meanings_es, uk, source";
  try {
    let { data, error } = await sb.rpc("search_dictionary", {
      q: query.writing, kana: query.kana, kata: dictKatakana(query.kana), meaning: query.meaning, lim: 60
    });
    // Falta la función (no se ha vuelto a ejecutar supabase/schema.sql): se busca
    // sin ella, solo por escritura y lectura
    if (error && ["PGRST202", "42883"].includes(error.code)) {
      const like = (value) => value.replace(/[\\%_]/g, "\\$&") + "%";
      const parts = [];
      if (query.writing) parts.push(sb.from("dictionary").select(fields).like("lemma", like(query.writing)).limit(40));
      for (const kana of query.kana ? [query.kana, dictKatakana(query.kana)] : []) {
        parts.push(sb.from("dictionary").select(fields).like("reading", like(kana)).limit(40));
      }
      const answers = await Promise.all(parts);
      error = answers.find((answer) => answer.error)?.error || null;
      data = answers.flatMap((answer) => answer.data || []);
    }
    if (error) throw error;
    // Lo aprobado por un administrador manda sobre la entrada de JMdict
    const rows = [...data].sort((a, b) => (b.source === "approved") - (a.source === "approved"));
    return { entries: rows.map(dictRemoteEntry), state: "ok" };
  } catch (error) {
    console.error("No se pudo consultar el diccionario:", error);
    return { entries: [], state: isNetworkError(error) ? "offline" : "error" };
  }
}

/* De dónde salen los resultados: sin sesión hay que decir claro que solo es el banco */
function dictNoteText() {
  const notes = {
    loading: t("Buscando también en el diccionario general…"),
    ok: t("Resultados del banco de la app y del diccionario general."),
    guest: sb
      ? t("Sin sesión iniciada solo se busca en el banco de la app (unas 6.700 palabras). Inicia sesión para buscar también en el diccionario general.")
      : t("Solo se busca en el banco de la app (unas 6.700 palabras)."),
    offline: t("Sin conexión: solo se busca en el banco de la app."),
    error: t("No se pudo consultar el diccionario general: solo se muestran las palabras del banco.")
  };
  return notes[dictState.remote] || "";
}

/* Estado de la palabra para el usuario: lo que dice su progreso, o que aún no la tiene */
function dictStatusHTML(entry) {
  const rec = userWords.get(entry.id);
  if (!rec) return `<span class="state-tag">${t("No está en tus palabras")}</span>`;
  const status = `<span class="state-tag state-${rec.status}">${t(WORD_STATUS_ONE[rec.status] || "Desconocida")}</span>`;
  const review = rec.studied
    ? t("En repaso: próximo el {date}", { date: formatDate(rec.nextReview) })
    : rec.origin === "manual" && rec.status !== "mastered" ? t("En cola para estudiar") : "";
  const lookups = rec.lookups ? plural(rec.lookups, "consulta", "consultas") : "";
  return [status, review, lookups].filter(Boolean).join(" · ");
}

/* Ficha de un resultado: todo lo que se sabe de la palabra */
function dictCardHTML(entry) {
  const rec = userWords.get(entry.id);
  const mine = BANK.meaning(entry, lang);
  const other = lang === "es" ? entry.en : entry.es;
  const parts = kanjiOf(entry.w).map((c) => {
    const kanji = BANK.kanji.get(c);
    return `<li><strong lang="ja">${escapeHTML(c)}</strong>
      <span>${kanji && meaningOf(kanji).length ? escapeHTML(gloss(kanji, 3)) : t("fuera del banco")}${
        BANK.kanjiLevel(c) ? ` · ${BANK.kanjiLevel(c)}` : ""}</span></li>`;
  }).join("");
  return `
    <article class="panel dict-card" data-dict-card="${escapeHTML(entry.id)}">
      <button class="icon-btn pop-close" type="button" data-dict-close
        title="${t("Cerrar")}" aria-label="${t("Cerrar")}">×</button>
      <div class="dict-head">
        <div class="dict-word" lang="ja">${escapeHTML(entry.w)}</div>
        <div>
          <div class="dict-reading" lang="ja">${escapeHTML(entry.r)}${
            entry.alt?.length ? ` <small>（${entry.alt.map(escapeHTML).join("、")}）</small>` : ""}</div>
          <div class="dict-tags">
            <span class="pill">${entry.level || t("Fuera del banco")}</span>
            <span class="helper">${entry.rank ? t("frecuencia n.º {rank}", { rank: entry.rank }) : t("sin puesto de frecuencia")}</span>
            ${entry.kana ? `<span class="helper">${t("suele escribirse en kana")}</span>` : ""}
            ${"speechSynthesis" in window
              ? `<button class="link-btn" type="button" data-dict-speak="${escapeHTML(entry.w)}">🔊 ${t("Escuchar")}</button>` : ""}
          </div>
        </div>
      </div>
      <p class="meaning">${escapeHTML(mine.join("; "))}</p>
      ${other?.length && other !== mine ? `<p class="helper">${escapeHTML(other.join("; "))}</p>` : ""}
      ${parts ? `<ul class="missed-list dict-kanji">${parts}</ul>` : ""}
      <p class="dict-status">${dictStatusHTML(entry)}</p>
      <div class="inline-form dict-actions">
        <button class="button button-primary" type="button" data-dict-mark="learn"
          ${rec?.studied || rec?.status === "mastered" ? "disabled" : ""}>${t("Estudiar esta palabra")}</button>
        <button class="button button-outline" type="button" data-dict-mark="mastered"
          ${rec?.status === "mastered" ? "disabled" : ""}>${t("Ya la domino")}</button>
      </div>
      <p class="message ${dictState.messageClass || ""}" role="status">${escapeHTML(dictState.message || "")}</p>
    </article>`;
}

function dictRowHTML(entry) {
  if (entry.id === dictState.open) return dictCardHTML(entry);
  const meaning = BANK.meaning(entry, lang).slice(0, 3).join(", ");
  return `
    <article class="item-row dict-row" role="button" tabindex="0" data-dict="${escapeHTML(entry.id)}">
      <div class="item-symbol word-symbol" lang="ja">${escapeHTML(entry.w)}</div>
      <div class="item-info">
        <div class="item-title" lang="ja">${escapeHTML(entry.r)}</div>
        <div class="item-sub">${escapeHTML(meaning)}</div>
      </div>
      <div class="item-state">${entry.level ? escapeHTML(entry.level) : ""}</div>
    </article>`;
}

function renderDictionary() {
  const { text, results } = dictState;
  $("dictCount").textContent = text ? plural(results.length, "resultado", "resultados") : "";
  $("dictCount").classList.toggle("hidden", !text);
  $("dictNote").textContent = text ? dictNoteText() : "";
  if (!text) {
    $("dictResults").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" lang="ja">辞</div>
        <h3>${t("Busca una palabra")}</h3>
        <p>${t("Escribe en japonés (漢字, かな), en romaji (kado) o su significado en español o inglés.")}</p>
      </div>`;
    return;
  }
  $("dictResults").innerHTML = results.length
    ? results.map(dictRowHTML).join("")
    : `<div class="no-items">${t("No se encontró nada para “{text}”.", { text: escapeHTML(text) })}</div>`;
}

/* Primero lo que ya hay en el dispositivo; después se completa con los niveles
   del banco que faltaban por descargar y con el diccionario general. */
async function runDictSearch(text) {
  const query = parseDictQuery(text, dictToHiragana);
  const id = ++dictSearchId;
  dictState = { text: query ? query.raw : "", results: [], open: "", remote: query ? "loading" : "" };
  const show = (remote = []) => {
    dictState.results = rankResults([...searchBank(), ...remote], query, lang);
    if (document.body.dataset.view !== "dict") switchView("dict"); else renderDictionary();
  };
  if (!query) return document.body.dataset.view === "dict" ? renderDictionary() : switchView("dict");
  show();

  const bankLoaded = BANK.LEVELS.every((level) => BANK.loaded(level));
  const [found] = await Promise.all([searchRemote(query), BANK.loadUpTo("N1").catch(() => {})]);
  if (id !== dictSearchId) return; // ya se buscó otra cosa
  dictState.remote = found.state;
  if (found.entries.length || !bankLoaded) show(found.entries); else renderDictionary();
}

/* Una palabra de fuera del banco necesita su entrada en el diccionario propio
   del usuario (almacén words) para poder mostrarla y estudiarla */
async function dictOwnEntry(entry) {
  if (BANK.words.has(entry.id) || words.has(entry.id)) return;
  const own = { id: entry.id, lemma: entry.w, reading: entry.r, meanings: entry.en, meaningsEs: entry.es,
    pos: "", source: "jmdict", updatedAt: Date.now() };
  words.set(own.id, own);
  await putRecords("words", [own]);
}
/* Su significado viaja con el progreso, para reconstruirla en otro dispositivo */
const dictOwnMeaning = (entry) => BANK.words.has(entry.id) ? "" : BANK.meaning(entry, lang).slice(0, 3).join(", ").slice(0, 120);

/* Abrir una ficha es consultar la palabra: queda anotada como algo que el
   usuario NO conoce todavía (nunca dominada ni "por confirmar"), y tendrá
   prioridad entre las palabras nuevas. No toca el repaso de una ya estudiada. */
async function recordLookup(entry) {
  await dictOwnEntry(entry);
  const rec = userWords.get(entry.id) || blankUserWord(entry.w, entry.r);
  rec.lookups = (rec.lookups || 0) + 1;
  rec.firstSeen ||= Date.now();
  rec.lastSeen = Date.now();
  // Lo que el usuario pidió a mano manda; lo demás pasa a ser "del diccionario"
  if (rec.origin !== "manual") rec.origin = "diccionario";
  // "Por confirmar" era una suposición; buscarla la desmiente. Lo ya demostrado
  // (dominada en una evaluación o en el repaso) no se toca.
  if (rec.status === "pre_known") rec.status = "unknown";
  if (!rec.meaning && dictOwnMeaning(entry)) rec.meaning = dictOwnMeaning(entry);
  await saveUserWord(rec);
  return rec;
}

/* Abre la ficha de un resultado (o la cierra si ya estaba abierta) */
async function openDictEntry(id) {
  dictState.open = dictState.open === id ? "" : id;
  dictState.message = dictState.messageClass = "";
  const entry = dictState.results.find((result) => result.id === dictState.open);
  // Cada palabra cuenta una vez por búsqueda, aunque se abra y se cierre
  if (entry && !dictState.counted?.has(id)) {
    (dictState.counted ??= new Set()).add(id);
    await recordLookup(entry);
  }
  renderDictionary();
  document.querySelector("[data-dict-card]")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* Botones de la ficha: "Estudiar esta palabra" y "Ya la domino" (los mismos
   caminos que en "Agregar palabra") */
async function markDictEntry(mode) {
  const entry = dictState.results.find((result) => result.id === dictState.open);
  if (!entry) return;
  await dictOwnEntry(entry);
  const rec = await markWord(entry.id, entry.w, entry.r, mode, dictOwnMeaning(entry));
  dictState.messageClass = "correct";
  dictState.message = mode === "mastered" ? t("{word} guardada como dominada.", { word: rec.lemma })
    : rec.studied ? t("{word} ya está en tus repasos.", { word: rec.lemma })
    : !hasKanjiChar(rec.lemma) || entry.kana ? t("{word} guardada. Al ir solo en kana no se repasa, pero se usará en tus textos.", { word: rec.lemma })
    : t("{word} agregada: será de las primeras palabras nuevas del repaso.", { word: rec.lemma });
  renderDictionary();
  updateCounts();
}

function bindDictionary() {
  const input = $("dictInput");
  const list = $("dictResults");
  list.addEventListener("click", (event) => {
    const pick = (selector) => event.target.closest(selector);
    if (pick("[data-dict-speak]")) return speak(pick("[data-dict-speak]").dataset.dictSpeak);
    if (pick("[data-dict-close]")) return openDictEntry(dictState.open);
    if (pick("[data-dict-mark]")) return markDictEntry(pick("[data-dict-mark]").dataset.dictMark);
    if (pick("[data-dict]")) openDictEntry(pick("[data-dict]").dataset.dict);
  });
  list.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-dict]")) {
      event.preventDefault();
      event.target.click();
    }
  });
  input.addEventListener("input", () => {
    clearTimeout(dictTimer);
    dictTimer = setTimeout(() => runDictSearch(input.value), 200);
  });
  $("dictForm").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(dictTimer);
    runDictSearch(input.value);
  });
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    parseDictQuery, dictMatch, rankResults, dictBankEntry, dictGloss, dictHiragana, lookupRecency, promptLearning
  };
}
