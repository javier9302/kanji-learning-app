/* =========================================
   KANJI LEARNING APP - progress.js
   Mis palabras → Análisis: qué ha demostrado el estudiante por nivel JLPT,
   su nivel en cada dimensión (vocabulario, kanjis, gramática, lectura) y
   cómo evoluciona semana a semana. Lo ve el plan premium; la foto semanal se
   guarda para todos, para que al pasar a premium ya haya historia. Las reglas
   están en progress-core.js y grammar-core.js; aquí va lo que toca al
   navegador. Se carga después de translate.js.

   meta.snapshots = { "2026-W43": foto (snapshotOf) + updatedAt }: una por
   semana, la última de cada semana. Se sincroniza (tabla progress_snapshots).
   ========================================= */

const SNAPSHOT_WEEKS = 104; // fotos que se guardan (dos años)

/* Premium con sesión y sin caducar (el plan lo pone un administrador; llega al sincronizar) */
function isPremium() {
  const plan = sync.config.plan;
  return !!sync.user && plan?.plan === "premium" && (!plan.until || Date.parse(plan.until) > Date.now());
}

/* =========================================
   1. EL PERFIL
   ========================================= */

/* Todo el análisis con los datos de este dispositivo. Necesita el banco entero:
   las listas JLPT de todos los niveles. grammar: true descarga el analizador de
   japonés si hace falta (unos 18 MB la primera vez); "ifLoaded" solo lo usa si ya
   está (al sincronizar no se descarga). Sin él, el perfil va sin gramática. */
async function computeProfile({ grammar = "ifLoaded" } = {}) {
  await BANK.loadUpTo("N1");
  const config = STUDY_CONFIG.analysis;

  // Vocabulario: las palabras con kanji de cada lista (las que casi siempre van en kana no se estudian)
  const assumed = new Set(assumedLevels());
  const words = [...BANK.words.values()].filter((word) => !word.kana && word.kanji.length);
  const wordStates = new Map(words.map((word) => [word.id, wordState(userWords.get(word.id), assumed.has(word.level))]));
  const vocab = levelBreakdown(words, (id) => wordStates.get(id));

  // Kanjis: también cuentan como supuestos los de las palabras que conoce
  const fromWords = new Set();
  for (const word of words) {
    if (["mastered", "assumed"].includes(wordStates.get(word.id))) word.kanji.forEach((c) => fromWords.add(c));
  }
  const kanjiList = [...BANK.kanji.values()].map((kanji) => ({ id: kanji.c, level: kanji.level }));
  const kanji = levelBreakdown(kanjiList, (c) => kanjiState(userKanji.get(c), fromWords.has(c)));

  // Lectura: con lo que conoce hoy
  const known = knownLemmas();
  const byId = new Map(texts.map((text) => [text.id, text]));
  const reading = readingSummary(await getAll("sessions"), (id) => byId.get(id),
    (id) => byId.has(id) ? textCoverage(byId.get(id), known) : null, Date.now(), config.recentTexts);

  // Gramática: lo que ha hecho con las frases que contienen cada estructura
  const tokenizer = await grammarTokenizer(grammar === true);
  const grammarMap = tokenizer ? grammarStates(await grammarEvents(tokenizer), config.grammar) : null;
  const grammarRows = grammarMap && grammarBreakdown(grammarMap);

  return {
    vocab, kanji, reading, practice: practiceSummary(meta.days),
    vocabLevel: estimateLevel(vocab, config.levelDone), kanjiLevel: estimateLevel(kanji, config.levelDone),
    readLevel: meta.reading.level || "",
    grammar: grammarRows, grammarStates: grammarMap,
    grammarLevel: grammarRows && estimateLevel(grammarRows, config.levelDone, grammarShare)
  };
}

/* =========================================
   2. GRAMÁTICA
   -----------------------------------------
   Cada frase se analiza con kuromoji una sola vez por sesión de la app
   (grammarCache) y detectGrammar dice qué estructuras lleva. Lo que el
   estudiante hizo con ella es un "evento" para grammarStates.
   ========================================= */

const grammarCache = new Map(); // texto de la frase -> ids de sus estructuras

/* El analizador: lo descarga si load; si no, solo si ya se pidió antes */
function grammarTokenizer(load) {
  if (load) return loadTokenizer().catch(() => null);
  return tokenizerPromise ? tokenizerPromise.catch(() => null) : Promise.resolve(null);
}

const sentenceTextOf = (sentence) => sentence.jp || (sentence.tokens || []).map((token) => token.surface).join("");

function grammarOf(tokenizer, sentence) {
  const jp = sentenceTextOf(sentence);
  if (!jp) return [];
  if (!grammarCache.has(jp)) grammarCache.set(jp, detectGrammar(tokenizer.tokenize(jp)));
  return grammarCache.get(jp);
}

/* Todo lo que ha hecho con frases:
     textos leídos   cada frase vista; leída sin consultar ninguna de sus palabras, "limpia"
     repasos         las frases enseñadas en «En una frase» (la última vez)
     Traducir        bien (correct, mostly) o mal (incorrect, también «No lo sé») */
async function grammarEvents(tokenizer) {
  const events = [];
  const add = (sentence, kind, at) => {
    const ids = sentence ? grammarOf(tokenizer, sentence) : [];
    if (ids.length) events.push({ ids, kind, at, day: isoDate(new Date(at)) });
  };
  const textsById = new Map(texts.map((text) => [text.id, text]));
  for (const session of await getAll("sessions")) {
    if (session.discarded || !session.finishedAt) continue;
    const clicked = new Set(Object.keys(session.clicks || {}));
    for (const sentence of textsById.get(session.textId)?.data?.sentences || []) {
      // Sin claves en sus palabras (textos antiguos) no se sabe si consultó alguna: solo cuenta como vista
      const keys = (sentence.tokens || []).filter((token) => token.key && !UNCOUNTED_POS.has(token.pos)).map((token) => token.key);
      add(sentence, keys.length && !keys.some((key) => clicked.has(key)) ? "clean" : "seen", session.finishedAt);
    }
  }
  const sentenceById = new Map();
  eachSentence((sentence) => sentenceById.set(sentence.id, sentence));
  for (const sentence of userSentences.values()) sentenceById.set(sentence.id, sentence);
  for (const stat of sentenceStats.values()) {
    if (stat.lastShown) add(sentenceById.get(stat.id), "seen", stat.lastShown);
  }
  for (const record of translationLog) {
    const kind = record.verdict === "correct" || record.verdict === "mostly" ? "good" : record.verdict === "incorrect" ? "bad" : "seen";
    add(sentenceById.get(record.sentenceId), kind, record.at);
  }
  return events;
}

/* =========================================
   3. LA FOTO SEMANAL
   ========================================= */

/* Guarda la foto de esta semana (sustituye la de esta semana si ya había). Si
   esta vez no se calculó la gramática, se conserva la que tuviera la semana. */
async function saveSnapshot(profile) {
  profile ??= await computeProfile();
  meta.snapshots ??= {};
  const before = meta.snapshots[weekKey()];
  const snapshot = { ...snapshotOf(profile), updatedAt: Date.now() };
  if (!snapshot.grammar && before?.grammar) {
    snapshot.grammar = before.grammar;
    snapshot.level.grammar = before.level?.grammar || "";
  }
  meta.snapshots[weekKey()] = snapshot;
  const weeks = Object.keys(meta.snapshots).sort();
  for (const old of weeks.slice(0, Math.max(0, weeks.length - SNAPSHOT_WEEKS))) delete meta.snapshots[old];
  await saveMeta();
  return meta.snapshots[weekKey()];
}

/* Al sincronizar: la foto de la semana y la de otros dispositivos. Nunca debe
   impedir el resto de la sincronización. Sin la tabla (falta ejecutar
   supabase/schema.sql) las fotos se quedan en el dispositivo. */
async function syncSnapshots(userId) {
  try {
    await saveSnapshot();
    await pullSnapshots(userId);
    await pushSnapshots(userId);
  } catch (error) {
    if (!tableMissing(error)) console.warn("No se pudo sincronizar el análisis:", error.message || error);
  }
}

async function pullSnapshots(userId) {
  const cursors = sync.config.cursors, pushed = sync.pushed.snapshots ??= {};
  const rows = await fetchChanged("progress_snapshots", "week", userId, cursors.progress_snapshots);
  let changed = false;
  for (const row of rows) {
    const stamp = Number(row.client_updated_at) || 0;
    pushed[row.week] = String(stamp);
    // De la misma semana gana la más reciente (cada dispositivo hace la suya)
    if ((meta.snapshots?.[row.week]?.updatedAt || 0) < stamp && row.data) {
      (meta.snapshots ??= {})[row.week] = { ...row.data, updatedAt: stamp };
      changed = true;
    }
  }
  if (changed) await saveMeta();
  if (rows.length) cursors.progress_snapshots = rows[rows.length - 1].updated_at;
}

async function pushSnapshots(userId) {
  const pushed = sync.pushed.snapshots ??= {};
  const weeks = Object.keys(meta.snapshots || {}).filter((week) => pushed[week] !== String(meta.snapshots[week].updatedAt));
  await pushRows("progress_snapshots", "user_id,week", weeks.map((week) => {
    const { updatedAt, ...data } = meta.snapshots[week];
    return { user_id: userId, week, data, client_updated_at: updatedAt };
  }), weeks.map((week) => [week, String(meta.snapshots[week].updatedAt)]), pushed);
}

/* =========================================
   4. LA PANTALLA
   ========================================= */

/* Estado, color y nombre. La barra cuenta como sabido lo de las dos primeras filas */
const STATE_STYLE = [
  ["mastered", "sw-mature", "Dominadas"],
  ["learning", "sw-learning", "Aprendiendo"],
  ["assumed", "sw-prek", "Dadas por sabidas"],
  ["new", "sw-new", "Sin estudiar"]
];
const GRAMMAR_STYLE = [
  ["mastered", "sw-mature", "Dominadas"],
  ["understood", "sw-learning", "Entendidas"],
  ["seen", "sw-prek", "Vistas"],
  ["unseen", "sw-new", "Sin ver"]
];

/* "N5 completo · N4 al 34 %" */
function levelText(estimate) {
  if (!estimate) return "—";
  if (!estimate.done && !estimate.current) return "—";
  if (!estimate.current) return t("{done} completo", estimate);
  return estimate.done
    ? t("{done} completo · {current} al {percent} %", estimate)
    : t("{current} al {percent} %", estimate);
}

/* Barras por nivel de una dimensión. known: lo que cuenta como sabido (el número de la derecha) */
function breakdownHTML(breakdown, style = STATE_STYLE, known = (row) => row.mastered + row.assumed) {
  return PC_LEVELS.filter((level) => breakdown[level]?.total).map((level) => {
    const row = breakdown[level];
    const segments = style.map(([state, cls, label]) => {
      if (!row[state]) return "";
      const tip = t("{name}: {count} de {total}", { name: t(label), count: row[state], total: row.total });
      return `<div class="seg ${cls}" style="flex-grow:${row[state]}" tabindex="0" data-tip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"></div>`;
    }).join("");
    return `
      <div class="level-row">
        <span class="level-name">${level}</span>
        <div class="stack">${segments}</div>
        <span class="level-total analysis-total">${known(row)} / ${row.total}</span>
      </div>`;
  }).join("");
}

/* Cuántos hay en cada estado, sumando todos los niveles: es también la leyenda */
function stateLegendHTML(breakdown, style = STATE_STYLE) {
  const sum = (state) => PC_LEVELS.reduce((total, level) => total + (breakdown[level]?.[state] || 0), 0);
  return `<div class="legend state-counts">${style.map(([state, cls, label]) =>
    `<span><i class="sw ${cls}"></i>${t(label)}: ${sum(state)}</span>`).join("")}</div>`;
}

const signed = (n) => n > 0 ? `+${n}` : String(n);

/* Las estructuras de gramática agrupadas por estado: qué maneja y qué le falta.
   El grupo dice el estado (no solo el color); al tocar una se ve su ejemplo. */
function grammarListHTML(states) {
  const name = (point) => lang === "es" ? point.es : point.en;
  return GRAMMAR_STYLE.map(([state, cls, label]) => {
    const points = GRAMMAR.filter((point) => states.get(point.id) === state);
    if (!points.length) return "";
    return `
      <details class="grammar-group"${state === "understood" || state === "seen" ? " open" : ""}>
        <summary><i class="sw ${cls}"></i>${t(label)} (${points.length})</summary>
        <ul class="grammar-list">${points.map((point) => `
          <li title="${escapeHTML(point.example)}"><strong lang="ja">${escapeHTML(point.ja)}</strong>
            <span>${escapeHTML(name(point))}</span>
            <span class="grammar-example" lang="ja">${escapeHTML(point.example)}</span></li>`).join("")}</ul>
      </details>`;
  }).join("");
}

/* El panel de gramática, o por qué no está */
function grammarPanelHTML(profile) {
  const levels = [...new Set(GRAMMAR.map((point) => point.level))].join(", ");
  if (!profile.grammar) {
    return `<div class="panel chart-panel"><h3>${t("Gramática")}</h3>
      <p class="helper">${t("No se pudo cargar el analizador de japonés (unos 18 MB la primera vez). Comprueba la conexión y vuelve a intentarlo.")}</p></div>`;
  }
  const config = STUDY_CONFIG.analysis.grammar;
  return `
    <div class="panel chart-panel">
      <h3>${t("Gramática por nivel")}</h3>
      <p class="helper">${t("Estructuras de {levels} en lo que has leído, repasado y traducido. Vista: apareció en tus frases. Entendida: tradujiste bien una frase con ella, o leíste {clean} sin consultar ninguna palabra. Dominada: la tradujiste bien en {days} días distintos.",
        { levels, clean: config.cleanReads, days: config.masteredDays })}</p>
      ${breakdownHTML(profile.grammar, GRAMMAR_STYLE, (row) => row.mastered + row.understood)}
      ${stateLegendHTML(profile.grammar, GRAMMAR_STYLE)}
      ${grammarListHTML(profile.grammarStates)}
    </div>`;
}

/* Las últimas semanas, en una tabla: palabras y kanjis dominados, textos y aciertos */
function historyHTML() {
  const weeks = Object.keys(meta.snapshots || {}).sort().slice(-8).reverse();
  if (weeks.length < 2) {
    return `<p class="helper">${t("Cada semana se guarda una foto de tu progreso. Vuelve la semana que viene para ver cómo avanzas.")}</p>`;
  }
  const rows = weeks.map((week) => {
    const snap = meta.snapshots[week];
    return `<tr>
      <td>${escapeHTML(formatDate(weekStart(week)))}</td>
      <td>${snapshotTotal(snap, "vocab")}</td>
      <td>${snapshotTotal(snap, "kanji")}</td>
      <td>${snapshotGrammar(snap) ?? "—"}</td>
      <td>${snap.reading?.texts ?? 0}</td>
      <td>${snap.practice?.accuracy ?? "—"}${snap.practice?.accuracy == null ? "" : " %"}</td>
    </tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="debug-table analysis-table">
    <thead><tr><th>${t("Semana del")}</th><th>${t("Palabras dominadas")}</th><th>${t("Kanjis dominados")}</th>
      <th>${t("Estructuras que manejas")}</th><th>${t("Textos leídos")}</th><th>${t("Aciertos (30 días)")}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* Sin premium: qué es y cómo conseguirlo */
function lockedHTML() {
  return `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">析</div>
      <h3>${t("El análisis de tu progreso es parte del plan premium")}</h3>
      <p>${t("Verás cuántas palabras y kanjis de cada nivel JLPT has demostrado, tu nivel estimado en vocabulario, kanjis y lectura, y cómo avanzas semana a semana.")}</p>
      <p class="helper">${sync.user
        ? t("Para activarlo, pide el plan premium al administrador.")
        : t("Inicia sesión con una cuenta premium para verlo.")}</p>
    </div>`;
}

async function renderAnalysis() {
  const area = $("analysisArea");
  if (!isPremium()) {
    area.innerHTML = lockedHTML();
    return;
  }
  area.innerHTML = `<p class="message">${t("Calculando…")}</p>`;
  let profile;
  try {
    profile = await computeProfile({ grammar: true });
  } catch {
    area.innerHTML = `<div class="empty-state"><h3>${t("No se pudo cargar el contenido de este nivel")}</h3>
      <p>${t("Comprueba la conexión y vuelve a intentarlo.")}</p></div>`;
    return;
  }
  const week = weekKey();
  const current = await saveSnapshot(profile);
  const delta = progressDelta(current, previousSnapshot(meta.snapshots, week));
  if (document.body.dataset.view !== "analysis") return;
  const { reading, practice } = profile;

  area.innerHTML = `
    <div class="stats-grid analysis-tiles">
      <article class="stat-card">
        <span>${t("Vocabulario")}</span>
        <strong class="analysis-level">${escapeHTML(levelText(profile.vocabLevel))}</strong>
      </article>
      <article class="stat-card">
        <span>${t("Kanjis")}</span>
        <strong class="analysis-level">${escapeHTML(levelText(profile.kanjiLevel))}</strong>
      </article>
      <article class="stat-card">
        <span>${t("Gramática")}</span>
        <strong class="analysis-level">${escapeHTML(levelText(profile.grammarLevel))}</strong>
      </article>
      <article class="stat-card">
        <span>${t("Nivel de tus textos")}</span>
        <strong class="analysis-level">${escapeHTML(profile.readLevel || "—")}</strong>
      </article>
    </div>
    <p class="helper analysis-delta">${delta
      ? escapeHTML(delta.grammar === null
        ? t("Desde la semana pasada: {words} palabras dominadas, {kanji} kanjis, {texts} textos leídos.",
          { words: signed(delta.words), kanji: signed(delta.kanji), texts: signed(delta.texts) })
        : t("Desde la semana pasada: {words} palabras dominadas, {kanji} kanjis, {grammar} estructuras, {texts} textos leídos.",
          { words: signed(delta.words), kanji: signed(delta.kanji), grammar: signed(delta.grammar), texts: signed(delta.texts) }))
      : t("Esta es tu primera foto semanal: la semana que viene verás aquí lo que has avanzado.")}</p>

    <div class="panel chart-panel">
      <h3>${t("Vocabulario por nivel")}</h3>
      <p class="helper">${t("Palabras con kanji de cada lista JLPT. Un nivel cuenta como completo cuando sabes al menos el {percent} % (dominadas y dadas por sabidas).",
        { percent: Math.round(STUDY_CONFIG.analysis.levelDone * 100) })}</p>
      ${breakdownHTML(profile.vocab)}
      ${stateLegendHTML(profile.vocab)}
    </div>

    <div class="panel chart-panel">
      <h3>${t("Kanjis por nivel")}</h3>
      <p class="helper">${t("Dominado: sabes su significado o escribirlo. Dado por sabido: aparece en palabras que conoces.")}</p>
      ${breakdownHTML(profile.kanji)}
      ${stateLegendHTML(profile.kanji)}
    </div>

    ${grammarPanelHTML(profile)}

    <h3 class="block-title">${t("Lectura y constancia")}</h3>
    <div class="stats-grid">
      <article class="stat-card"><span>${t("Textos leídos")}</span><strong>${reading.texts}</strong></article>
      <article class="stat-card"><span>${t("Textos en 30 días")}</span><strong>${reading.texts30}</strong></article>
      <article class="stat-card"><span>${t("Conoces de tus últimos textos")}</span><strong>${reading.coverage ?? "—"}${reading.coverage == null ? "" : " %"}</strong></article>
      <article class="stat-card"><span>${t("Consultas por cada 100 palabras")}</span><strong>${reading.lookups ?? "—"}</strong></article>
      <article class="stat-card"><span>${t("Días activos (30 días)")}</span><strong>${practice.activeDays} / 30</strong></article>
      <article class="stat-card"><span>${t("Aciertos en repasos (30 días)")}</span><strong>${practice.accuracy ?? "—"}${practice.accuracy == null ? "" : " %"}</strong></article>
    </div>

    <div class="panel chart-panel">
      <h3>${t("Evolución")}</h3>
      ${historyHTML()}
    </div>`;
}
