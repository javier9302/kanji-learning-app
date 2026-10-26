/* =========================================
   KANJI LEARNING APP - progress-core.js
   Análisis del progreso del estudiante: qué ha demostrado por nivel JLPT y
   qué nivel tiene en cada dimensión. Sin navegador ni datos del usuario
   alrededor, para poder probarlo con Node. Se carga después de
   learning-core.js; lo usa progress.js.

   Fase 1: vocabulario, kanjis, lectura y constancia. Fase 2: gramática (el
   catálogo y su medición están en grammar-core.js). La hoja de ruta llegará
   después, sobre esta misma forma.

   Cada palabra o kanji de las listas JLPT está en uno de cuatro estados:
     mastered  dominado: lo ha demostrado (repaso, evaluación, Traducir…)
     learning  lo está aprendiendo
     assumed   se da por sabido sin haberlo demostrado: su nivel se aprobó en
               la evaluación inicial, o salió en una lectura sin consultarlo
               ("por confirmar"), o, en un kanji, aparece en palabras que conoce
     new       sin estudiar
   Los números (umbral de nivel, textos recientes) vienen de STUDY_CONFIG.analysis.
   ========================================= */

const PC_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const PC_STATES = ["mastered", "learning", "assumed", "new"];
const PC_DAY = 86400000;

/* =========================================
   1. ESTADO DE CADA ELEMENTO
   ========================================= */

/* Una palabra. rec: su registro en userWords (o nada); assumed: su nivel se
   dio por sabido. Lo que el usuario ha demostrado manda sobre lo supuesto: una
   palabra marcada como desconocida no cuenta como sabida aunque su nivel sí. */
function wordState(rec, assumed) {
  if (rec?.status === "mastered") return "mastered";
  if (rec && (rec.studied || rec.status === "learning")) return "learning";
  if (rec?.status === "unknown") return "new";
  if (rec?.status === "pre_known" || assumed) return "assumed";
  return "new";
}

/* Un kanji. rec: su registro en userKanji; inKnownWords: aparece en palabras que conoce */
function kanjiState(rec, inKnownWords) {
  if (rec && (rec.status === "mastered" || rec.knowsMeaning || rec.canWrite)) return "mastered";
  if (rec?.studied) return "learning";
  if (inKnownWords) return "assumed";
  return "new";
}

/* =========================================
   2. POR NIVEL Y NIVEL ESTIMADO
   ========================================= */

/* Cuántos hay en cada estado por nivel.
     items    [{ id, level }]: la lista JLPT entera de esa dimensión
     stateOf  id -> uno de PC_STATES
   Devuelve { N5: { mastered, learning, assumed, new, total }, … } */
function levelBreakdown(items, stateOf) {
  const out = Object.fromEntries(PC_LEVELS.map((level) => [level, { mastered: 0, learning: 0, assumed: 0, new: 0, total: 0 }]));
  for (const item of items) {
    const row = out[item.level];
    if (!row) continue;
    row[stateOf(item.id)]++;
    row.total++;
  }
  return out;
}

/* Proporción que se sabe de un nivel: lo dominado más lo supuesto */
const knownShare = (row) => row.total ? (row.mastered + row.assumed) / row.total : 0;

/* Nivel estimado de una dimensión: el último nivel completo (se sabe al menos
   `threshold` de él y de todos los anteriores) y el siguiente, en curso.
   share: qué parte de un nivel se sabe (la gramática cuenta distinto). Los
   niveles vacíos no cuentan (la gramática aún no tiene todos).
   Devuelve { done: "N5" | null, current: "N4" | null, percent } (percent: lo
   que se sabe del nivel en curso, 0-100). */
function estimateLevel(breakdown, threshold = 0.8, share = knownShare) {
  let done = null;
  for (const level of PC_LEVELS.filter((name) => breakdown[name]?.total)) {
    if (share(breakdown[level]) < threshold) {
      return { done, current: level, percent: Math.round(share(breakdown[level]) * 100) };
    }
    done = level;
  }
  return { done, current: null, percent: 100 };
}

/* =========================================
   3. LECTURA Y CONSTANCIA
   ========================================= */

/* Lectura.
     sessions    [{ textId, finishedAt, discarded, clicks: { clave: … } }]
     textOf      id -> { total } (palabras del texto) o nada si ya no está
     coverageOf  id -> % de palabras que conoce hoy de ese texto, o null
     recent      cuántos textos recientes se miran
   Devuelve { texts, texts30, coverage, lookups }: textos leídos (en total y en
   30 días), % que conoce de sus últimos textos y palabras consultadas por cada
   100 palabras leídas (null si aún no ha leído nada). */
function readingSummary(sessions, textOf, coverageOf, now = Date.now(), recent = 5) {
  const read = sessions.filter((session) => !session.discarded && session.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt);
  const last = read.slice(0, recent);
  const coverages = last.map((session) => coverageOf(session.textId)).filter((value) => typeof value === "number");
  let looked = 0, words = 0;
  for (const session of last) {
    const total = textOf(session.textId)?.total || 0;
    if (!total) continue;
    looked += Object.keys(session.clicks || {}).length;
    words += total;
  }
  return {
    texts: new Set(read.map((session) => session.textId)).size,
    texts30: read.filter((session) => now - session.finishedAt <= 30 * PC_DAY).length,
    coverage: coverages.length ? Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length) : null,
    lookups: words ? Math.round((looked / words) * 1000) / 10 : null
  };
}

/* Constancia en los últimos 30 días: days = meta.days ({ "2026-10-21": { r, c } }) */
function practiceSummary(days, now = Date.now()) {
  let activeDays = 0, reviews = 0, correct = 0;
  for (let i = 0; i < 30; i++) {
    const day = days[pcIsoDate(new Date(now - i * PC_DAY))];
    if (!day?.r && !day?.t) continue;
    activeDays++;
    reviews += day.r || 0;
    correct += day.c || 0;
  }
  return { activeDays, reviews, accuracy: reviews ? Math.round((correct / reviews) * 100) : null };
}

/* =========================================
   4. LA FOTO SEMANAL
   -----------------------------------------
   Una por semana (la última de cada semana gana), para ver la evolución.
   Va compacta: es lo que se sincroniza (tabla progress_snapshots).
   ========================================= */

const pcIsoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/* Semana ISO de una fecha: "2026-W43" (empieza en lunes) */
function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // el jueves de esa semana decide el año
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / PC_DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* El lunes de una semana ISO, para enseñarla como fecha */
function weekStart(key) {
  const [year, week] = key.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/* El perfil en forma compacta: por nivel [dominados, aprendiendo, supuestos, total];
   en gramática, [dominadas, entendidas, vistas, total] y solo si se calculó */
function snapshotOf(profile, now = Date.now()) {
  const pack = (breakdown, fields) => Object.fromEntries(PC_LEVELS.filter((level) => breakdown[level])
    .map((level) => [level, [...fields.map((field) => breakdown[level][field]), breakdown[level].total]]));
  const snapshot = {
    at: now,
    vocab: pack(profile.vocab, ["mastered", "learning", "assumed"]), kanji: pack(profile.kanji, ["mastered", "learning", "assumed"]),
    level: { vocab: profile.vocabLevel.done || "", kanji: profile.kanjiLevel.done || "" },
    reading: profile.reading, practice: profile.practice
  };
  if (profile.grammar) {
    snapshot.grammar = pack(profile.grammar, ["mastered", "understood", "seen"]);
    snapshot.level.grammar = profile.grammarLevel?.done || "";
  }
  return snapshot;
}

/* Suma de dominados de todos los niveles de una dimensión de la foto */
const snapshotTotal = (snapshot, dimension, index = 0) =>
  Object.values(snapshot?.[dimension] || {}).reduce((sum, row) => sum + (row[index] || 0), 0);

/* Estructuras que maneja según la foto (dominadas y entendidas), o null si no tiene gramática */
const snapshotGrammar = (snapshot) => snapshot?.grammar
  ? snapshotTotal(snapshot, "grammar", 0) + snapshotTotal(snapshot, "grammar", 1) : null;

/* Lo que ha cambiado desde la foto anterior: { words, kanji, texts, grammar } (null sin foto
   anterior; grammar es null si a alguna de las dos le falta la gramática) */
function progressDelta(current, previous) {
  if (!previous) return null;
  const now = snapshotGrammar(current), before = snapshotGrammar(previous);
  return {
    words: snapshotTotal(current, "vocab") - snapshotTotal(previous, "vocab"),
    kanji: snapshotTotal(current, "kanji") - snapshotTotal(previous, "kanji"),
    texts: (current.reading?.texts || 0) - (previous.reading?.texts || 0),
    grammar: now === null || before === null ? null : now - before
  };
}

/* La foto de la semana anterior a `week` más reciente que haya */
function previousSnapshot(snapshots, week) {
  const earlier = Object.keys(snapshots).filter((key) => key < week).sort();
  return earlier.length ? snapshots[earlier[earlier.length - 1]] : null;
}

/* =========================================
   5. LA HOJA DE RUTA
   -----------------------------------------
   Reglas, no IA. Cada dimensión sin completar (vocabulario, kanjis,
   gramática) tiene su meta de la semana en su propio nivel, con elementos
   concretos. Van primero las de nivel más bajo y, en el mismo nivel, la más
   floja: el nivel objetivo es el de la primera. Así ir atrasado en una
   dimensión no frena las demás. Detrás van la lectura (si sus textos le
   cuestan o lee poco) y la constancia.
   Los números vienen de STUDY_CONFIG.analysis.roadmap.
   ========================================= */

/* Cuántos le faltan de un nivel para darlo por completo (share: la parte que ya sabe) */
const missingFor = (row, share, threshold) =>
  row?.total ? Math.max(0, Math.ceil(threshold * row.total - 1e-9) - Math.round(share(row) * row.total)) : 0;

/* dims      [{ key: "vocab" | "kanji" | "grammar", estimate, breakdown, share, next(level) -> ids }]
             next: los elementos que le faltan de un nivel, en el orden en que conviene aprenderlos
   reading   readingSummary;  practice  practiceSummary
   Devuelve { level, focus, steps }: level, el nivel objetivo (null si los ha completado todos);
   focus, la dimensión que va primero; steps, en orden:
     { kind: "vocab" | "kanji" | "grammar", level, percent, missing, count, items }
     { kind: "easier", coverage, lookups }   sus textos le cuestan
     { kind: "read", count }                 lee poco
     { kind: "habit", activeDays, count }    estudia pocos días */
function buildRoadmap({ dims, reading, practice }, config, threshold = 0.8) {
  const open = dims.filter((dim) => dim.estimate?.current).sort((a, b) =>
    PC_LEVELS.indexOf(a.estimate.current) - PC_LEVELS.indexOf(b.estimate.current) || a.estimate.percent - b.estimate.percent);
  const weekly = { vocab: config.weeklyWords, kanji: config.weeklyKanji, grammar: config.weeklyGrammar };

  const steps = open.map((dim) => {
    const level = dim.estimate.current;
    const missing = missingFor(dim.breakdown[level], dim.share, threshold);
    const count = Math.min(weekly[dim.key], missing || weekly[dim.key]);
    return {
      kind: dim.key, level, percent: dim.estimate.percent, missing, count,
      items: dim.next(level).slice(0, dim.key === "grammar" ? count : config.preview)
    };
  });
  const hard = reading.coverage !== null && reading.coverage < config.minCoverage ||
    reading.lookups !== null && reading.lookups > config.maxLookups;
  if (hard) steps.push({ kind: "easier", coverage: reading.coverage, lookups: reading.lookups });
  else if (reading.texts30 < config.weeklyTexts * 4) steps.push({ kind: "read", count: config.weeklyTexts });
  if (practice.activeDays < config.minActiveDays) {
    steps.push({ kind: "habit", activeDays: practice.activeDays, count: config.minActiveDays });
  }
  return { level: open[0]?.estimate.current || null, focus: open[0]?.key || null, steps };
}

/* =========================================
   6. LA EXPORTACIÓN
   -----------------------------------------
   Ajustes → Tus datos: un JSON con todo el progreso para dárselo a una IA
   (Claude, por ejemplo) y pedirle un análisis o la lista de las siguientes
   palabras. Lleva el perfil ya calculado, lo que sabe de cada kanji por sus
   palabras, las 100 siguientes palabras del orden y, debajo, el detalle de
   cada palabra y kanji. La guía de campos va en inglés: la lee la IA, no la
   interfaz; dice también cómo contestar con una lista para importarla
   (formato en README.md).
   ========================================= */

const EXPORT_VERSION = 2;

/* Lo que dice la tarjeta FSRS: estabilidad (días hasta olvidar un 10 %), dificultad (1-10) y olvidos */
function fsrsFacts(card) {
  if (!card) return null;
  const round = (n) => Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  return { stability: round(card.stability), difficulty: round(card.difficulty), lapses: card.lapses ?? 0,
    reps: card.reps ?? 0, due: card.due ? String(card.due).slice(0, 10) : null };
}

/* Una palabra del usuario. rec: su registro en userWords; entry: wordEntry (o nada);
   state: wordState. Solo los campos que dicen algo, para que el archivo no pese. */
function exportWordRow(rec, entry, state, language = "en") {
  const meaning = entry ? (language === "es" && entry.es?.length ? entry.es : entry.en) || [] : rec.meanings || [];
  const row = {
    w: entry?.w || rec.lemma || rec.id.split("|")[0], r: entry?.r || rec.reading || rec.id.split("|")[1] || "",
    meaning: meaning.slice(0, 3).join("; "), level: entry?.level || null, state, status: rec.status || "unknown",
    origin: rec.origin || null, studied: !!rec.studied, canReadKanji: !!rec.canReadKanji, knowsMeaning: !!rec.knowsMeaning,
    correct: rec.correctCount || 0, incorrect: rec.incorrectCount || 0, streakDays: rec.streakDays || 0,
    seenInTexts: rec.seen || 0, lookups: rec.lookups || 0,
    placement: rec.evalCorrect || rec.evalWrong ? { correct: rec.evalCorrect || 0, wrong: rec.evalWrong || 0 } : null,
    firstSeen: rec.firstSeen ? pcIsoDate(new Date(rec.firstSeen)) : null,
    lastReviewed: rec.lastReviewed || null, nextReview: rec.studied ? rec.nextReview || null : null,
    fsrs: fsrsFacts(rec.fsrs)
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

/* Un kanji del usuario. entry: el del banco ({ c, en, es, level }) o nada */
function exportKanjiRow(rec, entry, state, language = "en") {
  const meaning = entry ? (language === "es" && entry.es?.length ? entry.es : entry.en) || [] : [];
  const row = {
    c: rec.id, meaning: meaning.slice(0, 3).join("; "), level: entry?.level || null, state, status: rec.status || "unknown",
    knowsMeaning: !!rec.knowsMeaning, canWrite: !!rec.canWrite, writes: rec.writes || 0,
    correct: rec.correctCount || 0, incorrect: rec.incorrectCount || 0,
    lastReviewed: rec.lastReviewed || null, nextReview: rec.studied ? rec.nextReview || null : null,
    fsrs: fsrsFacts(rec.fsrs), writeFsrs: fsrsFacts(rec.writeFsrs)
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

/* La guía que acompaña al archivo: qué significa cada campo */
const EXPORT_GUIDE = {
  purpose: "Progress export from a Japanese study app (kanji, vocabulary, reading, translation). Use it to analyse the learner's progress, strengths, weaknesses and what to study next.",
  states: {
    mastered: "Demonstrated: answered correctly on several different days, long review interval, placement test, or (kanji) knows its meaning or can write it.",
    learning: "Being studied in spaced repetition, not yet mastered.",
    assumed: "Not demonstrated but counted as known: its JLPT level was passed in the placement test, it was read in a text without looking it up, or (kanji) it appears in known words.",
    new: "Not studied yet (or the learner said they don't know it)."
  },
  profile: "Computed summary. vocab/kanji/grammar: counts per JLPT level and state. *Level: { done: last completed level (>= levelDone of it known), current: level in progress, percent }. reading: texts read (total, last 30 days), coverage = % of words known in the latest texts, lookups = words looked up per 100 read. practice: last 30 days (active days, reviews, accuracy %). readLevel: level of the texts the learner reads.",
  words: "Every word the learner has interacted with (bank words in assumed levels that were never touched are only counted in profile.vocab). w: writing, r: reading, status: raw app status (mastered, learning, pre_known = seen while reading, unknown), origin: where it came from, correct/incorrect: review answers, streakDays: consecutive correct days, seenInTexts/lookups: times seen/looked up while reading, placement: placement-test answers, fsrs: spaced-repetition card (stability in days, difficulty 1-10, lapses = times forgotten, due date).",
  kanji: "Every kanji the learner has studied. knowsMeaning: passed its meaning card, canWrite: wrote it from memory, writes: times written, fsrs: meaning card, writeFsrs: writing card.",
  grammar: "N5 grammar points with their state: mastered (translated correctly on several days), understood (translated correctly once or read cleanly several times), seen (appeared in sentences), unseen. null if the grammar analyser could not load.",
  days: "Daily history: r = reviews, c = correct, n = new words, t = translations, tc = good translations.",
  snapshots: "One snapshot per ISO week (last one of the week). vocab/kanji per level: [mastered, learning, assumed, total]; grammar: [mastered, understood, seen, total].",
  readingSessions: "Finished texts, newest first: date, level, words in the text, words looked up, coverage = % of its words known today.",
  translations: "Translation exercises, newest first: sentence in Japanese, the learner's answer, verdict (correct, mostly, partial, incorrect; skipped when the learner skipped it), score 0-100, words looked up while translating.",
  roadmap: "The weekly plan the app computed (target level, words and grammar points to focus on).",
  kanjiReadings: "What the learner knows of each kanji through the words they know (kanji are learned in context). state: mastered (meaning known and every relevant reading seen in known words), partial (in some known word, but a relevant reading or the meaning is missing). knownReadings / missingReadings: relevant readings (used by at least 2 words of the app's list) seen or not yet seen. knownWords: how many known words use it. typed: per reading, right (ok) and wrong (ko) answers when typing it in its own box, and the last day. Kanji not listed are unknown.",
  recentWords: "The 40 words the learner started most recently (id = writing|reading, firstSeen = date). Use them to infer current interests (topics).",
  topicProfile: "Reserved for topic clusters (not computed yet); infer topics from recentWords.",
  nextWords: "The app's current top 100 new words, in order. score = total; parts = each component of the ordering, 0-1: frequency (rank in the frequency list), bridge (one new thing is best: one new kanji among known ones, or one new reading of a known kanji; 2+ new kanji is negative), unlock (how much common vocabulary the new kanji opens), coverage (gives a partial kanji a missing reading), topic (not used yet). why: the reason in words. queued: comes from an imported list.",
  queue: "The list imported by the learner, if any: the remaining ids come first among new words, in order.",
  howToCurate: "To choose the learner's next words yourself, reply with JSON in this format (the learner pastes it in Settings → Your data → Import list): {\"format\": \"kanji-app-queue\", \"version\": 1, \"note\": \"short reason\", \"words\": [\"有名|ゆうめい\", \"前置き|まえおき\"]}. Use ids writing|reading (reading in hiragana) exactly as in nextWords or words when possible; a bare writing is accepted unless it has several readings. Only words with kanji from the app's word list (JLPT N5-N1) can be imported: the app reports the rest. Words already known or being studied are skipped. Order them as they should be learned (one new thing at a time works best), up to about 100."
};

/* Arma el archivo. parts: lo que ya ha reunido progress.js (perfil, filas, historia) */
function buildProgressExport(parts, now = Date.now()) {
  const { profile = {}, words = [], kanji = [], ...rest } = parts;
  const byState = (rows) => Object.fromEntries(PC_STATES.map((state) => [state, rows.filter((row) => row.state === state).length]));
  return {
    app: "kanji-learning-app", version: EXPORT_VERSION, exportedAt: new Date(now).toISOString(),
    guide: EXPORT_GUIDE,
    totals: { words: words.length, wordsByState: byState(words), kanji: kanji.length, kanjiByState: byState(kanji) },
    profile, ...rest, words, kanji
  };
}

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    PC_LEVELS, PC_STATES, wordState, kanjiState, levelBreakdown, knownShare, estimateLevel,
    readingSummary, practiceSummary, weekKey, weekStart, snapshotOf, snapshotTotal, snapshotGrammar, progressDelta, previousSnapshot,
    missingFor, buildRoadmap, exportWordRow, exportKanjiRow, buildProgressExport, EXPORT_GUIDE
  };
}
