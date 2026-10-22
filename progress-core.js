/* =========================================
   KANJI LEARNING APP - progress-core.js
   Análisis del progreso del estudiante: qué ha demostrado por nivel JLPT y
   qué nivel tiene en cada dimensión. Sin navegador ni datos del usuario
   alrededor, para poder probarlo con Node. Se carga después de
   learning-core.js; lo usa progress.js.

   Fase 1 (esto): vocabulario, kanjis, lectura y constancia. La gramática y la
   hoja de ruta llegarán después, sobre esta misma forma.

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
   Devuelve { done: "N5" | null, current: "N4" | null, percent } (percent: lo
   que se sabe del nivel en curso, 0-100). */
function estimateLevel(breakdown, threshold = 0.8) {
  let done = null;
  for (const level of PC_LEVELS) {
    if (knownShare(breakdown[level]) < threshold) {
      return { done, current: level, percent: Math.round(knownShare(breakdown[level]) * 100) };
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

/* El perfil en forma compacta: por nivel [dominados, aprendiendo, supuestos, total] */
function snapshotOf(profile, now = Date.now()) {
  const pack = (breakdown) => Object.fromEntries(PC_LEVELS.map((level) => {
    const row = breakdown[level];
    return [level, [row.mastered, row.learning, row.assumed, row.total]];
  }));
  return {
    at: now,
    vocab: pack(profile.vocab), kanji: pack(profile.kanji),
    level: { vocab: profile.vocabLevel.done || "", kanji: profile.kanjiLevel.done || "" },
    reading: profile.reading, practice: profile.practice
  };
}

/* Suma de dominados de todos los niveles de una dimensión de la foto */
const snapshotTotal = (snapshot, dimension, index = 0) =>
  Object.values(snapshot?.[dimension] || {}).reduce((sum, row) => sum + (row[index] || 0), 0);

/* Lo que ha cambiado desde la foto anterior: { words, kanji, texts } (null sin foto anterior) */
function progressDelta(current, previous) {
  if (!previous) return null;
  return {
    words: snapshotTotal(current, "vocab") - snapshotTotal(previous, "vocab"),
    kanji: snapshotTotal(current, "kanji") - snapshotTotal(previous, "kanji"),
    texts: (current.reading?.texts || 0) - (previous.reading?.texts || 0)
  };
}

/* La foto de la semana anterior a `week` más reciente que haya */
function previousSnapshot(snapshots, week) {
  const earlier = Object.keys(snapshots).filter((key) => key < week).sort();
  return earlier.length ? snapshots[earlier[earlier.length - 1]] : null;
}

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    PC_LEVELS, PC_STATES, wordState, kanjiState, levelBreakdown, knownShare, estimateLevel,
    readingSummary, practiceSummary, weekKey, weekStart, snapshotOf, snapshotTotal, progressDelta, previousSnapshot
  };
}
