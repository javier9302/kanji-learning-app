/* =========================================
   KANJI LEARNING APP - kanji-table.js
   Mis palabras → Kanjis (premium): la tabla de kanjis, como la de Kanshudo.
   Cada kanji sale dominado, parcial o sin conocer según las PALABRAS que el
   estudiante conoce (reglas en kanji-core.js); al tocarlo se ven sus
   significados, sus lecturas (las que ya ha visto y las que le faltan), las
   palabras que conoce con él y las siguientes que le enseñarían lo que falta.
   Se carga después de progress.js (usa isPremium).

   Necesita bank/kanji-info.js (tools/build-kanji.mjs) y bank/readings.js,
   que se descargan al abrir la tabla.
   ========================================= */

const KANJI_STATE_STYLE = [
  ["mastered", "kanji-mastered", "Dominados"],
  ["partial", "kanji-partial", "Parciales"],
  ["unknown", "kanji-unknown", "Sin conocer"]
];

/* Una palabra cuenta como conocida para sus kanjis si la domina, si acertó su
   lectura la última vez que la repasó o si su nivel se dio por sabido en la
   evaluación (y no dijo después que no la sabe ni la está aprendiendo). Las
   que solo vio al leer no cuentan: no se sabe si las lee bien. */
function knownForKanji(rec, assumed) {
  if (rec?.status === "mastered") return true;
  if (rec?.studied) return !!rec.canReadKanji;
  if (rec?.status === "unknown" || rec?.status === "learning") return false;
  return assumed;
}

/* Las lecturas de kanji de una palabra (las del banco, corregidas por kanji-info.js) */
const kanjiReadingsOfWord = (id) => wordKanjiReadings(sentenceTagsOf(id), BANK.wordKanjiFixes[id]);

/* Las palabras que conoce, con las lecturas de sus kanjis */
function knownKanjiWords() {
  const assumed = new Set(assumedLevels());
  const ids = new Set();
  for (const word of BANK.words.values()) {
    if (!word.kana && word.kanji.length && knownForKanji(userWords.get(word.id), assumed.has(word.level))) ids.add(word.id);
  }
  // Las de fuera del banco (de sus textos o agregadas a mano)
  for (const rec of userWords.values()) {
    if (!BANK.words.has(rec.id) && hasKanjiChar(rec.lemma || "") && knownForKanji(rec, false)) ids.add(rec.id);
  }
  return [...ids].map((id) => ({ id, readings: kanjiReadingsOfWord(id) }));
}

/* ¿Sabe su significado? Lo marcó o lo acertó, sabe escribirlo, o el kanji es por sí
   solo una palabra que conoce (山) */
function kanjiMeaningKnown(c, knownIds) {
  const rec = userKanji.get(c);
  if (rec && (rec.knowsMeaning || rec.canWrite || rec.status === "mastered")) return true;
  return (BANK.byWriting.get(c) || []).some((word) => knownIds.has(word.id));
}

/* Todo lo de la tabla: el estado de cada kanji y la lista para agruparlos */
async function loadKanjiTable() {
  await Promise.all([BANK.loadUpTo("N1"), BANK.loadReadings(), BANK.loadKanjiInfo()]);
  const knownWords = knownKanjiWords();
  const knownIds = new Set(knownWords.map((word) => word.id));
  const states = kanjiStates({
    kanji: BANK.kanjiInfo, knownWords, meaningKnown: (c) => kanjiMeaningKnown(c, knownIds), config: STUDY_CONFIG.kanji
  });
  return { states, knownIds, list: [...BANK.kanjiInfo.values()] };
}

/* El nombre de cada grupo */
function kanjiGroupName(key) {
  if (KC_LEVELS.includes(key)) return key;
  if (key === "other") return t("Otros");
  if (key === "grade8") return t("Secundaria");
  if (key.startsWith("grade")) return t("{n}.º de primaria", { n: key.slice(5) });
  const top = Number(key.slice(3)), index = KC_FREQUENCY_BANDS.indexOf(top);
  return index === 0 ? t("Los {n} más importantes", { n: top }) : t("Del {from} al {to}", { from: KC_FREQUENCY_BANDS[index - 1] + 1, to: top });
}

/* "40 dominados · 30 parciales · 17 sin conocer" */
const kanjiCountsText = (counts) => KANJI_STATE_STYLE.map(([state, , label]) => `${counts[state]} ${t(label).toLowerCase()}`).join(" · ");

let kanjiTable = null; // lo último calculado: { states, knownIds, list }

async function renderKanjiTable() {
  const area = $("kanjiArea");
  if (!isPremium()) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" lang="ja">漢</div>
        <h3>${t("La tabla de kanjis es parte del plan premium")}</h3>
        <p>${t("Verás todos los kanjis por nivel, cuáles dominas por las palabras que conoces, qué lecturas te faltan y qué palabras te las enseñan.")}</p>
        <p class="helper">${sync.user ? t("Para activarlo, pide el plan premium al administrador.") : t("Inicia sesión con una cuenta premium para verlo.")}</p>
      </div>`;
    return;
  }
  area.innerHTML = `<p class="message">${t("Calculando…")}</p>`;
  try {
    kanjiTable = await loadKanjiTable();
  } catch {
    area.innerHTML = `<div class="empty-state"><h3>${t("No se pudo cargar el contenido de este nivel")}</h3>
      <p>${t("Comprueba la conexión y vuelve a intentarlo.")}</p></div>`;
    return;
  }
  if (document.body.dataset.view !== "kanji") return;
  const { states, list } = kanjiTable;
  const stateOf = (c) => states.get(c)?.state || "unknown";
  const groups = kanjiGroups(list, prefs.kanjiGroup, stateOf);
  const total = { mastered: 0, partial: 0, unknown: 0 };
  for (const group of groups) for (const state of KC_STATES) total[state] += group.counts[state];

  area.innerHTML = `
    <p class="helper">${t("Un kanji está dominado cuando sabes su significado y has visto todas sus lecturas habituales en palabras que conoces; parcial, si lo conoces de alguna palabra pero te falta alguna lectura o el significado. Toca uno para ver qué te falta.")}</p>
    <div class="legend state-counts">${KANJI_STATE_STYLE.map(([state, cls, label]) =>
      `<span><i class="sw kanji-swatch ${cls}"></i>${t(label)}: ${total[state]}</span>`).join("")}</div>
    ${groups.map((group) => `
      <section class="kanji-group">
        <h3>${escapeHTML(kanjiGroupName(group.key))} <span class="helper">${group.counts.total} · ${escapeHTML(kanjiCountsText(group.counts))}</span></h3>
        <div class="kanji-grid" lang="ja">${group.kanji.map((c) => {
          const state = stateOf(c);
          return `<button class="kanji-cell kanji-${state}" type="button" data-kanji="${escapeHTML(c)}"
            aria-label="${escapeHTML(`${c}: ${t(KANJI_STATE_STYLE.find(([s]) => s === state)[2])}`)}">${escapeHTML(c)}</button>`;
        }).join("")}</div>
      </section>`).join("")}`;
}

/* Las siguientes palabras que enseñarían una lectura: las más frecuentes que aún no conoce */
function wordsTeaching(c, reading, knownIds, limit = 3) {
  const out = [];
  for (const word of BANK.words.values()) {
    if (word.kana || knownIds.has(word.id) || !word.kanji.includes(c)) continue;
    if (kanjiReadingsOfWord(word.id).some(([k, r]) => k === c && r === reading)) out.push(word);
  }
  const rank = (word) => BANK.frequency[word.id] || 1e6;
  return out.sort((a, b) => rank(a) - rank(b) || BANK.LEVELS.indexOf(a.level) - BANK.LEVELS.indexOf(b.level)).slice(0, limit);
}

const kanjiWordHTML = (word) => `<li><strong lang="ja">${escapeHTML(word.w)}</strong> <span lang="ja">${escapeHTML(word.r)}</span>
  <span class="helper">${escapeHTML(BANK.meaning(word, lang).slice(0, 2).join(", "))}</span></li>`;

/* La ficha de un kanji */
function kanjiDetailHTML(c) {
  const { states, knownIds } = kanjiTable;
  const info = BANK.kanjiInfo.get(c) || { c, readings: [], en: [], es: [] };
  const state = states.get(c) || { state: "unknown", meaning: false, known: [], missing: [], words: [] };
  const relevant = relevantReadings(info.readings, STUDY_CONFIG.kanji);
  const counts = new Map((info.readings || []).map(([reading, words]) => [reading, words]));
  const meaning = (lang === "es" && info.es?.length ? info.es : info.en) || [];
  const label = KANJI_STATE_STYLE.find(([s]) => s === state.state)[2];
  const facts = [info.level, info.grade >= 1 && info.grade <= 8 ? kanjiGroupName(`grade${info.grade}`) : "",
    info.importance ? t("importancia n.º {n}", { n: info.importance }) : ""].filter(Boolean);

  const readingRow = (reading) => {
    const seen = state.known.includes(reading);
    return `<li class="${seen ? "reading-known" : "reading-missing"}"><span lang="ja">${escapeHTML(reading)}</span>
      <span class="helper">${escapeHTML(plural(counts.get(reading) || 0, "palabra", "palabras"))} · ${seen ? t("vista") : t("te falta")}</span></li>`;
  };
  const rare = (info.readings || []).map(([reading]) => reading).filter((reading) => !relevant.includes(reading));
  const known = state.words.map((id) => BANK.words.get(id)).filter(Boolean);
  const next = state.missing.map((reading) => [reading, wordsTeaching(c, reading, knownIds)]).filter(([, list]) => list.length);

  return `
    <div class="dialog-head">
      <div class="dialog-symbol kanji-big kanji-${state.state}" lang="ja">${escapeHTML(c)}</div>
      <div>
        <h3>${escapeHTML(meaning.slice(0, 4).join(", ") || "—")}</h3>
        <p class="helper">${escapeHTML([t(label), ...facts].join(" · "))}</p>
        ${state.meaning ? "" : `<p class="helper">${t("Aún no has demostrado su significado: márcalo en Repasar con el contenido «Kanjis».")}</p>`}
      </div>
    </div>
    <h4>${t("Lecturas")}</h4>
    <ul class="kanji-readings">${relevant.map(readingRow).join("") || `<li class="helper">${t("Ninguna palabra del banco usa este kanji.")}</li>`}</ul>
    ${rare.length ? `<p class="helper">${t("Poco usadas (no hacen falta para dominarlo):")} <span lang="ja">${escapeHTML(rare.join("、"))}</span></p>` : ""}
    <h4>${t("Palabras que conoces con él")}</h4>
    ${known.length ? `<ul class="kanji-words">${known.slice(0, 12).map(kanjiWordHTML).join("")}</ul>${known.length > 12 ? `<p class="helper">${t("y {n} más", { n: known.length - 12 })}</p>` : ""}`
      : `<p class="helper">${t("Todavía ninguna.")}</p>`}
    ${next.length ? `<h4>${t("Para completarlo")}</h4>${next.map(([reading, list]) => `
      <p class="helper">${t("Te enseñan la lectura {reading}:", { reading })}</p>
      <ul class="kanji-words">${list.map(kanjiWordHTML).join("")}</ul>`).join("")}` : ""}`;
}

function openKanjiDetail(c) {
  if (!kanjiTable) return;
  $("kanjiDetail").innerHTML = kanjiDetailHTML(c);
  $("kanjiDialog").showModal();
}

function bindKanjiTable() {
  if ([...$("kanjiGroupSelect").options].some((option) => option.value === prefs.kanjiGroup)) $("kanjiGroupSelect").value = prefs.kanjiGroup;
  $("kanjiGroupSelect").addEventListener("change", () => {
    prefs.kanjiGroup = $("kanjiGroupSelect").value;
    saveLocal("kanji-prefs", prefs);
    renderKanjiTable();
  });
  $("kanjiArea").addEventListener("click", (event) => {
    const cell = event.target.closest("[data-kanji]");
    if (cell) openKanjiDetail(cell.dataset.kanji);
  });
  $("kanjiCloseBtn").addEventListener("click", () => $("kanjiDialog").close());
}
