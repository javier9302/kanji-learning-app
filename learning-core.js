/* =========================================
   KANJI LEARNING APP - learning-core.js
   Qué se estudia y en qué orden, por KANJIS. Sin navegador ni datos del usuario
   alrededor, para poder probarlo con Node. Se carga después de study-config.js
   y antes de study.js.

   1. Palabras nuevas: kanjiGate decide si una palabra se puede proponer.
   2. Escribir: writingLevel, nextWritingKanji y writingTestResult.
   Los números (repaso cada cuántos kanjis, tamaño de la prueba…) vienen de
   STUDY_CONFIG.
   ========================================= */

const LC_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
/* ¿Este nivel está dentro del pedido? (un nivel desconocido, nunca) */
const lcWithin = (level, max) => !!level && LC_LEVELS.indexOf(level) >= 0 && LC_LEVELS.indexOf(level) <= LC_LEVELS.indexOf(max);

/* =========================================
   1. PALABRAS NUEVAS
   -----------------------------------------
   Lo que decide no es el nivel de la PALABRA, sino el de sus KANJIS. Hay
   palabras de N5 con un kanji de N1, y palabras de N3 hechas solo con kanjis
   de N5.
     - Una palabra se puede proponer si todos sus kanjis son del nivel pedido
       o inferior. Un kanji que el usuario ya conoce nunca bloquea.
     - Excepción para palabras de varios kanjis: pueden llevar kanjis de un nivel
       superior si el usuario conoce al menos uno de los suyos (knownNeeded) y
       la palabra es del nivel pedido o inferior.
   ========================================= */

/* entry  { kanji: ["学", "校"], level: "N5" | null }
   ctx    { level: "N5", kanjiLevel(c) -> nivel | null, known: Set de kanjis, knownNeeded = 1 }
   Devuelve { ok, above, known } (above: los kanjis por encima del nivel que no conoce) */
function kanjiGate(entry, ctx) {
  const kanji = entry.kanji || [];
  const known = kanji.filter((c) => ctx.known.has(c));
  const above = kanji.filter((c) => !ctx.known.has(c) && !lcWithin(ctx.kanjiLevel(c), ctx.level));
  if (!above.length) return { ok: true, above, known };
  const exception = kanji.length > 1 && known.length >= (ctx.knownNeeded ?? 1) && lcWithin(entry.level, ctx.level);
  return { ok: exception, above, known };
}

/* =========================================
   2. ESCRIBIR
   -----------------------------------------
   Se avanza nivel a nivel: no se piden kanjis de N4 mientras queden kanjis de
   N5 por escribir. Un nivel se termina escribiendo todos sus kanjis, o
   aprobando su prueba (para quien ya sabe escribirlos). De vez en cuando
   (cada reviewEvery kanjis) sale uno ya escrito, el que hace más que no se
   escribe, para no olvidarlo.
   ========================================= */

/* El nivel que toca escribir: el primero que no está terminado ni aprobado.
     kanjiByLevel  { N5: ["日", …], … }
     written(c)    ¿ya lo sabe escribir?
     skipped       niveles aprobados con la prueba
   Devuelve el nivel, o null si están todos terminados. */
function writingLevel(kanjiByLevel, written, skipped = []) {
  for (const level of LC_LEVELS) {
    if (skipped.includes(level)) continue;
    if ((kanjiByLevel[level] || []).some((c) => !written(c))) return level;
  }
  return null;
}

/* El siguiente kanji para escribir.
   state:
     kanjiByLevel, written(c), skipped   (como en writingLevel)
     useful(c)       ¿sale en palabras que el usuario conoce? Esos van primero
     lastWritten(c)  cuándo lo escribió por última vez (ms, 0 si nunca)
     turn            cuántos kanjis lleva en esta sesión (para el repaso)
     avoid           el kanji anterior, para no repetirlo seguido
   config: STUDY_CONFIG.writing
   Devuelve { c, level, review } o null si no hay nada que escribir. */
function nextWritingKanji(state, config) {
  const level = writingLevel(state.kanjiByLevel, state.written, state.skipped);
  const reachable = level ? LC_LEVELS.slice(0, LC_LEVELS.indexOf(level) + 1) : LC_LEVELS;
  // Ya escritos (o de un nivel aprobado), hasta el nivel actual: los que se pueden repasar
  const done = reachable.flatMap((lv) => (state.kanjiByLevel[lv] || [])
    .filter((c) => state.written(c) || (state.skipped || []).includes(lv)).map((c) => ({ c, level: lv })))
    .filter((item) => item.c !== state.avoid);
  const pending = level ? (state.kanjiByLevel[level] || []).filter((c) => !state.written(c) && c !== state.avoid) : [];

  const reviewTurn = config.reviewEvery > 0 && state.turn > 0 && state.turn % config.reviewEvery === 0;
  if (done.length && (reviewTurn || !pending.length)) {
    const oldest = [...done].sort((a, b) => (state.lastWritten(a.c) || 0) - (state.lastWritten(b.c) || 0) || (a.c < b.c ? -1 : 1))[0];
    return { ...oldest, review: true };
  }
  if (!pending.length) return null;
  // Primero los que salen en palabras que conoce; dentro de cada grupo, el orden del banco (por frecuencia)
  const next = [...pending].sort((a, b) => (state.useful(b) ? 1 : 0) - (state.useful(a) ? 1 : 0))[0];
  return { c: next, level, review: false };
}

/* Resultado de la prueba para saltar un nivel.
     results  [{ c, mistakes, shown, hinted }] por cada kanji de la prueba
   Un kanji vale si se escribió sin pedir que se mostrara, sin pistas y con
   como mucho maxMistakes fallos. Se aprueba con pass kanjis buenos.
   Devuelve { passed, good: [kanjis que valen], total } */
function writingTestResult(results, config) {
  const good = results.filter((r) => !r.shown && !r.hinted && r.mistakes <= config.maxMistakes).map((r) => r.c);
  return { passed: results.length >= config.size && good.length >= config.pass, good, total: results.length };
}

/* Kanjis de la prueba de un nivel: los que aún no sabe escribir, al azar.
   random() se puede pasar para que las pruebas sean repetibles. */
function writingTestKanji(kanjiList, written, size, random = Math.random) {
  const pool = kanjiList.filter((c) => !written(c));
  const list = (pool.length >= size ? pool : kanjiList).slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, size);
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { kanjiGate, writingLevel, nextWritingKanji, writingTestResult, writingTestKanji };
}
