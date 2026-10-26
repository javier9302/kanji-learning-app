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
   meta.roadmap = { level, words, grammar, updatedAt }: la hoja de ruta que se
   calculó al abrir el análisis. Sus palabras salen antes en el repaso
   (scoreWord) y sus estructuras se piden en los textos de la IA (promptParams).
   meta.summary = { key: "2026-W43:es", text }: el resumen de la semana que
   escribió la IA (función summarize-progress, sección 6).
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
  const kanjiStates = new Map(kanjiList.map(({ id }) => [id, kanjiState(userKanji.get(id), fromWords.has(id))]));
  const kanji = levelBreakdown(kanjiList, (c) => kanjiStates.get(c));

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
    vocab, kanji, reading, practice: practiceSummary(meta.days), kanjiStates,
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
   3. LA HOJA DE RUTA
   ========================================= */

/* Las palabras de la hoja de ruta, para el repaso (solo premium) */
const roadmapWords = () => new Set(isPremium() ? meta.roadmap?.words || [] : []);

/* La hoja de ruta de un perfil (buildRoadmap) con lo que le falta de cada dimensión:
     vocabulario  las palabras nuevas de ese nivel en el orden en que el repaso las propondría
     kanjis       los de ese nivel sin estudiar ni aparecer en palabras que conoce
     gramática    las estructuras sin entender; primero las que ya ha visto */
function roadmapOf(profile) {
  const config = STUDY_CONFIG.analysis;
  const candidates = newWordCandidates().list;
  const order = { seen: 0, unseen: 1 };
  const dims = [
    { key: "vocab", estimate: profile.vocabLevel, breakdown: profile.vocab, share: knownShare,
      next: (level) => candidates.filter((card) => card.entry.level === level).map((card) => card.id) },
    { key: "kanji", estimate: profile.kanjiLevel, breakdown: profile.kanji, share: knownShare,
      next: (level) => [...BANK.kanji.values()].filter((kanji) => kanji.level === level && profile.kanjiStates.get(kanji.c) === "new")
        .map((kanji) => kanji.c) },
    profile.grammar && { key: "grammar", estimate: profile.grammarLevel, breakdown: profile.grammar, share: grammarShare,
      next: (level) => GRAMMAR.filter((point) => point.level === level && profile.grammarStates.get(point.id) in order)
        .sort((a, b) => order[profile.grammarStates.get(a.id)] - order[profile.grammarStates.get(b.id)])
        .map((point) => point.id) }
  ].filter(Boolean);
  const roadmap = buildRoadmap({ dims, reading: profile.reading, practice: profile.practice }, config.roadmap, config.levelDone);
  // Las palabras de la semana para el repaso: todas las de la meta, no solo las que se enseñan
  const vocab = roadmap.steps.find((step) => step.kind === "vocab");
  roadmap.words = vocab ? dims[0].next(vocab.level).slice(0, vocab.count) : [];
  roadmap.grammar = roadmap.steps.find((step) => step.kind === "grammar")?.items || [];
  return roadmap;
}

async function saveRoadmap(roadmap) {
  meta.roadmap = { level: roadmap.level, words: roadmap.words, grammar: roadmap.grammar, updatedAt: Date.now() };
  await saveMeta();
}

/* Las estructuras de la hoja de ruta, como se le piden a la IA en los textos (solo premium) */
const roadmapGrammar = () => (isPremium() ? meta.roadmap?.grammar || [] : [])
  .map((id) => GRAMMAR_BY_ID.get(id)).filter(Boolean).map((point) => ({ ja: point.ja, en: point.en }));

/* =========================================
   4. LA FOTO SEMANAL
   ========================================= */

/* Guarda la foto de esta semana (sustituye la de esta semana si ya había). Si
   esta vez no se calculó la gramática o la hoja de ruta, se conserva la que
   tuviera la semana. roadmap: { level, focus } para la vista del profesor. */
async function saveSnapshot(profile, roadmap = null) {
  profile ??= await computeProfile();
  meta.snapshots ??= {};
  const before = meta.snapshots[weekKey()];
  const snapshot = { ...snapshotOf(profile), updatedAt: Date.now() };
  if (!snapshot.grammar && before?.grammar) {
    snapshot.grammar = before.grammar;
    snapshot.level.grammar = before.level?.grammar || "";
  }
  if (roadmap) snapshot.roadmap = { level: roadmap.level, focus: roadmap.focus };
  else if (before?.roadmap) snapshot.roadmap = before.roadmap;
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
   5. LA PANTALLA
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

/* Un paso de la hoja de ruta: [título, explicación] (HTML ya escapado) */
function roadmapStepHTML(step) {
  const config = STUDY_CONFIG.analysis.roadmap;
  const list = (items) => `<span lang="ja">${items.map(escapeHTML).join("、")}</span>`;
  switch (step.kind) {
    case "vocab": return [
      escapeHTML(t("Vocabulario de {level}: {n} palabras nuevas esta semana", { level: step.level, n: step.count })),
      `${escapeHTML(t("Te faltan {missing} para completar {level}. Ya salen primero en tu repaso; las siguientes:", step))} ${
        list(step.items.map((id) => wordEntry(id)?.w || id.split("|")[0]))}`];
    case "kanji": return [
      escapeHTML(t("Kanjis de {level}: {n} nuevos esta semana", { level: step.level, n: step.count })),
      `${escapeHTML(t("Te faltan {missing} para completar {level}. Repásalos en Repasar con el contenido «Kanjis» o escríbelos en Escribir. Los siguientes:", step))} ${list(step.items)}`];
    case "grammar": return [
      escapeHTML(t("Gramática de {level}: {n} estructuras esta semana", { level: step.level, n: step.count })),
      `${step.items.map((id) => GRAMMAR_BY_ID.get(id)).map((point) =>
        `<span lang="ja">${escapeHTML(point.ja)}</span> (${escapeHTML(lang === "es" ? point.es : point.en)})`).join(" · ")}. ${
        escapeHTML(t("Los textos que crees con IA las incluirán; tradúcelos en Traducir para que cuenten. Te faltan {missing} para completar {level}.", step))}`];
    case "easier": return [
      escapeHTML(t("Tus textos te cuestan")),
      escapeHTML(step.coverage !== null && step.coverage < config.minCoverage
        ? t("Conoces el {coverage} % de las palabras de tus últimos textos. Lee textos de un nivel más bajo (Ajustes → Lectura) hasta pasar del {min} %.", { coverage: step.coverage, min: config.minCoverage })
        : t("Consultas {lookups} palabras de cada 100 que lees. Lee textos de un nivel más bajo (Ajustes → Lectura) o más cortos.", step))];
    case "read": return [
      escapeHTML(t("Lee {n} textos esta semana", { n: step.count })),
      escapeHTML(t("Leer es lo que más vocabulario y gramática te da en contexto, y cada texto cuenta para tu gramática."))];
    case "habit": return [
      escapeHTML(t("Estudia más días")),
      escapeHTML(t("Has estudiado {days} de los últimos 30 días. Mejor un poco cada día: al menos {n} días al mes.", { days: step.activeDays, n: step.count }))];
    default: return ["", ""];
  }
}

/* La hoja de ruta: el objetivo, lo más flojo y los pasos de la semana */
function roadmapHTML(roadmap, profile) {
  const names = { vocab: t("el vocabulario"), kanji: t("los kanjis"), grammar: t("la gramática") };
  const estimate = { vocab: profile.vocabLevel, kanji: profile.kanjiLevel, grammar: profile.grammarLevel }[roadmap.focus];
  return `
    <div class="panel roadmap-panel">
      <h3>${t("Tu hoja de ruta")}</h3>
      <p class="helper">${roadmap.level
        ? escapeHTML(t("Objetivo: completar {level}. Lo que más te falta ahora es {focus} ({percent} % de {level}).",
          { level: roadmap.level, focus: names[roadmap.focus], percent: estimate.percent }))
        : escapeHTML(t("Has completado todos los niveles que mide el análisis. Sigue leyendo y repasando para no olvidarlo."))}</p>
      ${roadmap.steps.length ? `<ol class="roadmap-steps">${roadmap.steps.map((step) => {
        const [title, body] = roadmapStepHTML(step);
        return `<li><strong>${title}</strong><span>${body}</span></li>`;
      }).join("")}</ol>` : ""}
    </div>`;
}

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
  const roadmap = roadmapOf(profile);
  await saveRoadmap(roadmap);
  const current = await saveSnapshot(profile, roadmap);
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

    <div id="analysisSummary" class="panel analysis-summary hidden" aria-live="polite"></div>
    ${roadmapHTML(roadmap, profile)}

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
  showSummary(profile, roadmap, delta);
}

/* =========================================
   6. EL RESUMEN DE LA SEMANA (IA)
   -----------------------------------------
   La función summarize-progress (Gemini) lo escribe a partir de los números
   de esta pantalla: no calcula nada. Uno por semana e idioma, guardado en el
   servidor (progress_summaries) y aquí (meta.summary). Si la función no está
   desplegada o falla, no se enseña nada y no se reintenta en 6 horas.
   ========================================= */

const SUMMARY_RETRY_MS = 6 * 3600000;

/* La llamada a la función de Supabase, aparte para poder imitarla en las pruebas */
function invokeSummary(body) {
  return sb.functions.invoke("summarize-progress", { body });
}

/* Los números que se le pasan: los mismos que ve el estudiante */
function summaryFacts(profile, roadmap, delta) {
  return {
    levels: { vocab: profile.vocabLevel, kanji: profile.kanjiLevel, grammar: profile.grammarLevel || null, texts: profile.readLevel || null },
    delta, reading: profile.reading, practice: profile.practice,
    roadmap: roadmap.steps.map(({ kind, level, count, missing }) => ({ kind, level, count, missing })),
    grammarNext: roadmapGrammar()
  };
}

async function showSummary(profile, roadmap, delta) {
  const box = $("analysisSummary");
  const key = `${weekKey()}:${lang}`;
  const render = (text) => {
    box.innerHTML = `<h3>${t("Tu semana")}</h3><p>${escapeHTML(text)}</p>`;
    box.classList.remove("hidden");
  };
  if (meta.summary?.key === key) return render(meta.summary.text);
  const failed = loadLocal("kanji-summary-failed", { key: "", at: 0 });
  if (!sb || !isPremium() || failed.key === key && Date.now() - failed.at < SUMMARY_RETRY_MS) return;
  box.innerHTML = `<p class="helper">${t("Escribiendo el resumen de tu semana…")}</p>`;
  box.classList.remove("hidden");
  try {
    const { data, error } = await invokeSummary({ week: weekKey(), lang, facts: summaryFacts(profile, roadmap, delta) });
    if (error || !data?.summary) throw error || new Error("sin resumen");
    meta.summary = { key, text: data.summary };
    await saveMeta();
    if (document.contains(box)) render(data.summary);
  } catch (error) {
    saveLocal("kanji-summary-failed", { key, at: Date.now() });
    console.warn("No se pudo escribir el resumen de la semana:", error?.message || error);
    box.classList.add("hidden");
  }
}

/* =========================================
   7. DESCARGAR MIS DATOS
   -----------------------------------------
   Ajustes → Tus datos: el progreso entero en un JSON para analizarlo con una
   IA (buildProgressExport en progress-core.js). Es para todos, no solo
   premium: los datos son suyos. Descarga el analizador de japonés si hace
   falta, para que vaya la gramática.
   ========================================= */

async function progressExport() {
  const profile = await computeProfile({ grammar: true });
  await ensureStudyBank(); // lecturas de cada kanji y su información, para el estado y el orden
  const known = knownLemmas();
  const textsById = new Map(texts.map((text) => [text.id, text]));
  const sentenceById = new Map();
  eachSentence((sentence) => sentenceById.set(sentence.id, sentence));
  for (const sentence of userSentences.values()) sentenceById.set(sentence.id, sentence);

  const assumed = new Set(assumedLevels());
  const wordRows = [...userWords.values()].map((rec) => {
    const entry = wordEntry(rec.id);
    return exportWordRow(rec, entry, wordState(rec, assumed.has(entry?.level)), lang);
  }).sort((a, b) => PC_STATES.indexOf(a.state) - PC_STATES.indexOf(b.state) || (b.correct + b.incorrect) - (a.correct + a.incorrect));
  const kanjiRows = [...userKanji.values()].map((rec) =>
    exportKanjiRow(rec, BANK.kanji.get(rec.id), profile.kanjiStates.get(rec.id) || kanjiState(rec, false), lang))
    .sort((a, b) => PC_STATES.indexOf(a.state) - PC_STATES.indexOf(b.state));

  const sessions = (await getAll("sessions")).filter((session) => !session.discarded && session.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt).map((session) => {
      const text = textsById.get(session.textId);
      return {
        date: isoDate(new Date(session.finishedAt)), title: text?.title || null, level: text?.level || null,
        words: text?.total || null, lookups: Object.keys(session.clicks || {}).length,
        coverage: text ? textCoverage(text, known) : null
      };
    });
  const translations = [...translationLog].reverse().map((record) => ({
    date: isoDate(new Date(record.at)), sentence: sentenceTextOf(sentenceById.get(record.sentenceId) || {}) || null,
    answer: record.answer || null, verdict: record.source === "skip" ? "skipped" : record.verdict || null,
    score: record.score ?? null, lookups: record.lookups?.length || 0
  }));

  // Lo que sabe de cada kanji por sus palabras (Mis palabras → Kanjis): solo los que conoce algo
  const tableStates = currentKanjiStates().states;
  const kanjiReadings = [...tableStates].filter(([, state]) => state.state !== "unknown").map(([c, state]) => ({
    c, level: BANK.kanjiLevel(c), state: state.state, meaningKnown: state.meaning, knownReadings: state.known,
    missingReadings: state.missing, knownWords: state.words.length, ...(userKanji.get(c)?.readings ? { typed: userKanji.get(c).readings } : {})
  })).sort((a, b) => KC_STATES.indexOf(a.state) - KC_STATES.indexOf(b.state));
  // Lo último que ha empezado a estudiar: de ahí saldrán sus temas (fase D)
  const recentWords = [...userWords.values()].filter((rec) => rec.studied || rec.status === "mastered")
    .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)).slice(0, 40).map((rec) => {
      const entry = wordEntry(rec.id);
      return { id: rec.id, meaning: entry ? meaningOf(entry).slice(0, 2).join("; ") : "", firstSeen: rec.firstSeen ? isoDate(new Date(rec.firstSeen)) : null };
    });
  // Las 100 siguientes palabras nuevas, como las pondría el orden ahora
  const nextWords = newWordCandidates().list.slice(0, STUDY_CONFIG.ranking.debugTop).map((card, i) => ({
    position: i + 1, id: card.id, meaning: meaningOf(card.entry).slice(0, 2).join("; "), level: card.entry.level,
    score: Math.round(card.info.score * 100) / 100,
    parts: card.info.ranked ? Object.fromEntries(Object.entries(card.info.ranked.parts).map(([key, value]) => [key, Math.round(value * 100) / 100])) : null,
    why: whyText(card.info), queued: !!card.info.queued
  }));
  const queue = meta.queue?.ids?.length ? { note: meta.queue.note || "", importedAt: isoDate(new Date(meta.queue.importedAt)),
    total: meta.queue.total, remaining: queueRemaining() } : null;

  const { kanjiStates, grammarStates: grammarMap, ...summary } = profile;
  return buildProgressExport({
    profile: { ...summary, assumedLevels: [...assumed], levelDone: STUDY_CONFIG.analysis.levelDone },
    grammar: grammarMap ? GRAMMAR.map((point) => ({ id: point.id, ja: point.ja, meaning: point.en, level: point.level, state: grammarMap.get(point.id) })) : null,
    roadmap: meta.roadmap?.updatedAt ? meta.roadmap : null,
    days: meta.days, snapshots: meta.snapshots || {},
    readingSessions: sessions, translations,
    kanjiReadings, recentWords, topicProfile: null, nextWords, queue,
    words: wordRows, kanji: kanjiRows
  });
}

async function downloadProgress() {
  const button = $("exportProgressBtn"), message = $("exportMessage");
  button.disabled = true;
  message.textContent = t("Preparando tus datos…");
  try {
    const data = await progressExport();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `progreso-japones-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    message.textContent = t("Listo: {words} palabras y {kanji} kanjis. Adjunta el archivo en un chat con Claude y pídele que analice tu progreso.",
      { words: data.words.length, kanji: data.kanji.length });
  } catch (error) {
    console.warn("No se pudieron exportar los datos:", error?.message || error);
    message.textContent = t("No se pudieron preparar tus datos. Comprueba la conexión y vuelve a intentarlo.");
  } finally {
    button.disabled = false;
  }
}

/* =========================================
   8. IMPORTAR UNA LISTA
   -----------------------------------------
   Ajustes → Tus datos → Importar lista: las siguientes palabras nuevas las
   elige una persona o una IA (con el archivo de arriba) en lugar del orden.
   Se pegan o se elige un archivo; parseQueueText y resolveQueue
   (ranking-core.js) las comprueban contra el banco y dicen qué no vale.
   Se guardan en meta.queue, en este dispositivo; newWordCandidates las pone
   primero hasta que se acaban. Formato en README.md.
   ========================================= */

/* Cómo están las palabras de la lista para el estudiante */
function queueLookup() {
  // Sin kanji no hay lectura que preguntar: cuenta como las que casi siempre van en kana
  const entry = (word) => word && { ...word, kana: word.kana || !word.kanji.length };
  return {
    byId: (id) => entry(BANK.words.get(id)) || null,
    byWriting: (writing) => (BANK.sensesOf(writing) || []).map(entry),
    state: (id) => {
      const rec = userWords.get(id);
      return rec?.status === "mastered" ? "known" : rec?.studied ? "studied" : null;
    }
  };
}

/* El informe de una importación, en líneas */
function queueReportHTML(result) {
  const list = (ids) => `<span lang="ja">${escapeHTML(ids.map((id) => String(id).split("|")[0]).join("、"))}</span>`;
  const lines = [];
  if (result.ids.length) lines.push(escapeHTML(t("Importadas {n}: saldrán primero entre tus palabras nuevas, en este orden.", { n: result.ids.length })));
  else lines.push(escapeHTML(t("Ninguna palabra de la lista se puede estudiar: no se ha cambiado nada.")));
  if (result.notFound.length) lines.push(`${escapeHTML(t("No están en la lista de palabras de la app ({n}):", { n: result.notFound.length }))} ${list(result.notFound)}`);
  if (result.ambiguous.length) lines.push(`${escapeHTML(t("Tienen varias lecturas; escribe cuál, como 角|かど ({n}):", { n: result.ambiguous.length }))} <span lang="ja">${
    result.ambiguous.map((item) => escapeHTML(`${item.item} (${item.options.map((id) => id.split("|")[1]).join(" / ")})`)).join("、")}</span>`);
  const skipped = (reason) => result.skipped.filter((item) => item.reason === reason).map((item) => item.id);
  if (skipped("known").length || skipped("studied").length) {
    lines.push(`${escapeHTML(t("Ya las sabes o las estás estudiando ({n}):", { n: skipped("known").length + skipped("studied").length }))} ${list([...skipped("known"), ...skipped("studied")])}`);
  }
  if (skipped("kana").length) lines.push(`${escapeHTML(t("Van en kana y no se repasan ({n}):", { n: skipped("kana").length }))} ${list(skipped("kana"))}`);
  if (result.duplicates.length) lines.push(`${escapeHTML(t("Repetidas ({n}):", { n: result.duplicates.length }))} ${list(result.duplicates)}`);
  return lines.map((line) => `<p>${line}</p>`).join("");
}

/* Ajustes → Tus datos: cuánto queda de la lista importada */
function renderQueueStatus() {
  const total = meta.queue?.ids?.length ? meta.queue.total || meta.queue.ids.length : 0;
  const left = total ? queueRemaining().length : 0;
  $("queueStatus").textContent = total
    ? t("Lista importada: te quedan {left} de {total} palabras. Salen antes que el orden de siempre.", { left, total })
    : "";
  $("queueClearBtn").classList.toggle("hidden", !total);
}

async function importQueue() {
  const report = $("queueReport");
  let parsed;
  try {
    parsed = parseQueueText($("queueText").value);
  } catch (error) {
    report.innerHTML = `<p>${escapeHTML(error.message === "empty"
      ? t("Pega la lista o elige un archivo primero.")
      : t("No se entiende el archivo: tiene que llevar una lista de palabras (mira el formato en README.md)."))}</p>`;
    return;
  }
  await BANK.loadUpTo("N1").catch(() => {});
  const result = resolveQueue(parsed.items, queueLookup());
  report.innerHTML = queueReportHTML(result);
  if (!result.ids.length) return;
  meta.queue = { ids: result.ids, note: parsed.note, importedAt: Date.now(), total: result.ids.length };
  await saveMeta();
  renderQueueStatus();
  $("queueImportBtn").classList.add("hidden");
}

function bindQueueImport() {
  $("queueOpenBtn").addEventListener("click", () => {
    $("queueText").value = "";
    $("queueFile").value = "";
    $("queueReport").innerHTML = "";
    $("queueImportBtn").classList.remove("hidden");
    $("queueDialog").showModal();
    $("queueText").focus();
  });
  $("queueFile").addEventListener("change", async () => {
    const file = $("queueFile").files[0];
    if (file) $("queueText").value = await file.text();
  });
  $("queueImportBtn").addEventListener("click", importQueue);
  $("queueCloseBtn").addEventListener("click", () => $("queueDialog").close());
  $("queueClearBtn").addEventListener("click", async () => {
    if (!confirm(t("¿Quitar la lista importada? Las palabras nuevas volverán a salir en el orden de siempre."))) return;
    meta.queue = {};
    await saveMeta();
    renderQueueStatus();
  });
  renderQueueStatus();
}
