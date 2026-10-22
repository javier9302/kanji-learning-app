/* =========================================
   KANJI LEARNING APP - progress.js
   Mis palabras → Análisis: qué ha demostrado el estudiante por nivel JLPT,
   su nivel en cada dimensión y cómo evoluciona semana a semana. Lo ve el
   plan premium; la foto semanal se guarda para todos, para que al pasar a
   premium ya haya historia. Las reglas están en progress-core.js; aquí va
   lo que toca al navegador. Se carga después de translate.js.

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
   las listas JLPT de todos los niveles. */
async function computeProfile() {
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

  return {
    vocab, kanji, reading, practice: practiceSummary(meta.days),
    vocabLevel: estimateLevel(vocab, config.levelDone), kanjiLevel: estimateLevel(kanji, config.levelDone),
    readLevel: meta.reading.level || ""
  };
}

/* =========================================
   2. LA FOTO SEMANAL
   ========================================= */

/* Guarda la foto de esta semana (sustituye la de esta semana si ya había) */
async function saveSnapshot(profile) {
  profile ??= await computeProfile();
  meta.snapshots ??= {};
  meta.snapshots[weekKey()] = { ...snapshotOf(profile), updatedAt: Date.now() };
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
   3. LA PANTALLA
   ========================================= */

const STATE_STYLE = [
  ["mastered", "sw-mature", "Dominadas"],
  ["learning", "sw-learning", "Aprendiendo"],
  ["assumed", "sw-prek", "Dadas por sabidas"],
  ["new", "sw-new", "Sin estudiar"]
];

/* "N5 completo · N4 al 34 %" */
function levelText(estimate) {
  if (!estimate.done && !estimate.current) return "—";
  if (!estimate.current) return t("Todos los niveles");
  return estimate.done
    ? t("{done} completo · {current} al {percent} %", estimate)
    : t("{current} al {percent} %", estimate);
}

/* Barras por nivel de una dimensión: dominados, aprendiendo, supuestos y el resto */
function breakdownHTML(breakdown) {
  return PC_LEVELS.filter((level) => breakdown[level].total).map((level) => {
    const row = breakdown[level];
    const segments = STATE_STYLE.map(([state, cls, label]) => {
      if (!row[state]) return "";
      const tip = t("{name}: {count} de {total}", { name: t(label), count: row[state], total: row.total });
      return `<div class="seg ${cls}" style="flex-grow:${row[state]}" tabindex="0" data-tip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"></div>`;
    }).join("");
    return `
      <div class="level-row">
        <span class="level-name">${level}</span>
        <div class="stack">${segments}</div>
        <span class="level-total analysis-total">${row.mastered + row.assumed} / ${row.total}</span>
      </div>`;
  }).join("");
}

/* Cuántos hay en cada estado, sumando todos los niveles: es también la leyenda */
function stateLegendHTML(breakdown) {
  const sum = (state) => PC_LEVELS.reduce((total, level) => total + breakdown[level][state], 0);
  return `<div class="legend state-counts">${STATE_STYLE.map(([state, cls, label]) =>
    `<span><i class="sw ${cls}"></i>${t(label)}: ${sum(state)}</span>`).join("")}</div>`;
}

const signed = (n) => n > 0 ? `+${n}` : String(n);

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
      <td>${snap.reading?.texts ?? 0}</td>
      <td>${snap.practice?.accuracy ?? "—"}${snap.practice?.accuracy == null ? "" : " %"}</td>
    </tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="debug-table analysis-table">
    <thead><tr><th>${t("Semana del")}</th><th>${t("Palabras dominadas")}</th><th>${t("Kanjis dominados")}</th>
      <th>${t("Textos leídos")}</th><th>${t("Aciertos (30 días)")}</th></tr></thead>
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
    profile = await computeProfile();
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
    <div class="stats-grid">
      <article class="stat-card">
        <span>${t("Vocabulario")}</span>
        <strong class="analysis-level">${escapeHTML(levelText(profile.vocabLevel))}</strong>
      </article>
      <article class="stat-card">
        <span>${t("Kanjis")}</span>
        <strong class="analysis-level">${escapeHTML(levelText(profile.kanjiLevel))}</strong>
      </article>
      <article class="stat-card">
        <span>${t("Nivel de tus textos")}</span>
        <strong class="analysis-level">${escapeHTML(profile.readLevel || "—")}</strong>
      </article>
    </div>
    <p class="helper analysis-delta">${delta
      ? escapeHTML(t("Desde la semana pasada: {words} palabras dominadas, {kanji} kanjis, {texts} textos leídos.",
          { words: signed(delta.words), kanji: signed(delta.kanji), texts: signed(delta.texts) }))
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
