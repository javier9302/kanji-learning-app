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

/* ---------- 2. Vista ---------- */

let dictState = { text: "", results: [], open: "" }; // open: id del resultado desplegado
let dictTimer = null;

const dictToHiragana = (text) => window.wanakana?.toHiragana ? window.wanakana.toHiragana(text) : text;

/* Palabras del banco ya cargadas que coinciden */
function searchBank(query) {
  return [...BANK.words.values()].map((word) => dictBankEntry(word, BANK.frequency));
}

function dictRowHTML(entry) {
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

function runDictSearch(text) {
  const query = parseDictQuery(text, dictToHiragana);
  dictState = { text: query ? query.raw : "", results: [], open: "" };
  if (query) dictState.results = rankResults(searchBank(query), query, lang);
  if (document.body.dataset.view !== "dict") switchView("dict"); else renderDictionary();
}

function bindDictionary() {
  const input = $("dictInput");
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
  module.exports = { parseDictQuery, dictMatch, rankResults, dictBankEntry, dictGloss, dictHiragana };
}
