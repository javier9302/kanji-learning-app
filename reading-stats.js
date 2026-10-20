/* =========================================
   KANJI LEARNING APP - reading-stats.js
   Estadísticas de lectura (Mis palabras → Estadísticas). Después de reading.js.
   ========================================= */

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
  $("statKanjiWrite").textContent = [...userKanji.values()].filter((k) => k.canWrite).length;
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
  // Fallos en las evaluaciones de lectura y en Traducir (no entendió su significado)
  for (const word of mine) word.failures = (word.evalWrong || 0) + (word.meaningWrong || 0);
  $("failedList").innerHTML = top("failures", "fallo", "fallos",
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
