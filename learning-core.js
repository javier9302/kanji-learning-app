/* =========================================
   KANJI LEARNING APP - learning-core.js
   Qué se estudia y en qué orden, por KANJIS. Sin navegador ni datos del usuario
   alrededor, para poder probarlo con Node. Se carga después de study-config.js
   y antes de study.js.

   1. Palabras nuevas: kanjiGate decide si una palabra se puede proponer.
   2. Escribir: writingLevel, nextWritingKanji, writingRating y writingTestResult.
   3. Leer cuenta como repaso: readingCredit y readingInterval.
   4. Hoy: planToday, la sesión del día.
   Los números (repaso cada cuántos kanjis, tamaño de la prueba…) vienen de
   STUDY_CONFIG.
   ========================================= */

const LC_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
/* Tramos de importancia de un kanji (como en la tabla de kanjis): los 100 primeros, los 250… */
const LC_BANDS = [100, 250, 500, 1000, 1500, 2000, 2500];
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
   Repaso espaciado (FSRS), con una tarjeta de escritura por kanji, aparte de
   la de su significado. Cada vez sale, por este orden:
     1. un repaso que toca: su tarjeta ya venció (los recién aprendidos vuelven
        a los pocos minutos, en la misma sesión), el más atrasado primero;
     2. un kanji nuevo, si hoy no ha llegado a newPerDay, de los que el
        estudiante ya ha visto (en palabras que conoce o repasa, o estudiados en
        Repasar): un kanji se aprende por sus palabras. De simple a complejo:
        primero los de palabras que mejor conoce, después los más importantes
        (tramos de 100, 250, 500…: cuánto vocabulario frecuente abren) y, en el
        mismo tramo, los de menos trazos. Los de un nivel aprobado con la prueba
        no salen. Con unseenEvery > 0, cada tantos nuevos uno que aún no ha visto
        de su nivel de escritura (por defecto, nunca);
     3. si no queda nada de eso, práctica extra: el ya escrito que vence antes.
   El nivel de escritura es el primero que no ha terminado (todos sus kanjis
   escritos alguna vez) ni aprobado con la prueba.
   ========================================= */

/* El nivel que toca escribir: el primero que no está terminado ni aprobado.
     kanjiByLevel  { N5: ["日", …], … }
     written(c)    ¿lo ha escrito alguna vez (tiene tarjeta de escritura)?
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
     now            ahora (ms)
     kanjiByLevel   { N5: ["日", …], … } en el orden del banco
     dueAt(c)       cuándo vence su tarjeta de escritura (ms), o null si nunca lo escribió
     seen(c)        cuánto lo ha visto: 0 nada; más, más cerca le queda (palabras que domina > que repasa > lecturas)
     strokes(c)     sus trazos (0 si no se sabe);  importance(c)  su puesto por el vocabulario que abre
     skipped        niveles aprobados con la prueba
     newToday       kanjis nuevos que ya ha empezado hoy
     avoid          el kanji anterior, para no repetirlo seguido
   config: STUDY_CONFIG.writing
   Devuelve { c, level, kind: "review" | "new" | "extra", seen } o null si no hay nada. */
function nextWritingKanji(state, config) {
  const levelOf = new Map();
  for (const level of LC_LEVELS) for (const c of state.kanjiByLevel[level] || []) if (!levelOf.has(c)) levelOf.set(c, level);
  const rank = (c) => LC_LEVELS.indexOf(levelOf.get(c));
  const all = [...levelOf.keys()].filter((c) => c !== state.avoid);
  const written = all.filter((c) => state.dueAt(c) !== null);
  const soonest = (a, b) => state.dueAt(a) - state.dueAt(b) || rank(a) - rank(b);

  const due = written.filter((c) => state.dueAt(c) <= state.now).sort(soonest);
  if (due.length) return { c: due[0], level: levelOf.get(due[0]), kind: "review", seen: true };

  if (state.newToday < config.newPerDay) {
    const level = writingLevel(state.kanjiByLevel, (c) => state.dueAt(c) !== null, state.skipped);
    const fresh = all.filter((c) => state.dueAt(c) === null && !state.skipped.includes(levelOf.get(c)));
    const strokes = state.strokes || (() => 0), importance = (c) => (state.importance && state.importance(c)) || Infinity;
    const band = (c) => { const i = LC_BANDS.findIndex((top) => importance(c) <= top); return i < 0 ? LC_BANDS.length : i; };
    const seen = fresh.filter((c) => state.seen(c) > 0).sort((a, b) => state.seen(b) - state.seen(a) ||
      band(a) - band(b) || strokes(a) - strokes(b) || importance(a) - importance(b) || rank(a) - rank(b));
    const unseen = level && config.unseenEvery > 0 ? fresh.filter((c) => levelOf.get(c) === level && !(state.seen(c) > 0)) : [];
    const discoverTurn = config.unseenEvery > 0 && state.newToday % config.unseenEvery === config.unseenEvery - 1;
    const pick = unseen.length && (discoverTurn || !seen.length) ? unseen[0] : seen[0];
    if (pick) return { c: pick, level: levelOf.get(pick), kind: "new", seen: state.seen(pick) > 0 };
  }

  if (!written.length) return null;
  const extra = [...written].sort(soonest)[0];
  return { c: extra, level: levelOf.get(extra), kind: "extra", seen: true };
}

/* Cómo le fue con un kanji, como valoración de FSRS.
     attempt  { mistakes, hinted, shown }: trazos fallados, si pidió una pista
              (o salió sola tras tres fallos en un trazo) y si pidió que se lo
              mostraran o lo dejó a medias
   config: STUDY_CONFIG.writing.rating { forgiveMistakes, againMistakes }
   El primer fallo no cuenta (un trazo torcido no es no saberlo). */
function writingRating({ mistakes = 0, hinted = false, shown = false }, config) {
  if (shown) return "again";
  const counted = Math.max(0, mistakes - config.forgiveMistakes);
  if (counted >= config.againMistakes) return "again";
  if (hinted || counted > 0) return "hard";
  return "good";
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

/* =========================================
   3. LEER CUENTA COMO REPASO
   -----------------------------------------
   Una palabra que toca repasar y aparece en un texto que se termina de leer
   cuenta como repaso. Reconocerla en contexto es más fácil que recordarla en
   una tarjeta, así que vale menos:
     - solo si toca repasarla (no las que vencen más tarde);
     - si no se tocó: como «Difícil», y su intervalo crece como mucho maxGrowth
       veces (y al menos minDays días);
     - si se tocó para ver su lectura o su significado: «Otra vez»;
     - «La conocía, solo comprobaba»: ni suma ni resta (lo dice el estudiante);
     - con furigana encima no cuenta: la lectura estaba a la vista;
     - una vez al día como mucho, y tras flashcardEvery seguidas leyendo, la
       siguiente tiene que ser una tarjeta en Repasar (para seguir recordando);
     - nunca la da por dominada (eso solo lo hace Repasar).
   Los números vienen de STUDY_CONFIG.readingReview.
   ========================================= */

/* Qué vale leer una palabra en un texto terminado.
     rec       su registro en userWords
     tapped    se tocó en el texto (para ver lectura o significado)
     checked   se marcó «La conocía, solo comprobaba»
     furigana  salió con furigana encima
     day       hoy ("2026-10-27")
   Devuelve { result: "good" | "again" | null, reason } (reason dice por qué:
   notDue, checked, tapped, furigana, today, flashcard, good). */
function readingCredit({ rec, tapped, checked, furigana, day }, config) {
  if (!rec?.studied || !rec.nextReview || rec.nextReview > day) return { result: null, reason: "notDue" };
  if (checked) return { result: null, reason: "checked" };
  if (tapped) return { result: "again", reason: "tapped" };
  if (furigana) return { result: null, reason: "furigana" };
  if (rec.lastReadReview === day) return { result: null, reason: "today" };
  if ((rec.readStreak || 0) >= config.flashcardEvery) return { result: null, reason: "flashcard" };
  return { result: "good", reason: "good" };
}

/* Días hasta el próximo repaso tras una lectura acertada: los que diga FSRS
   (con la valoración de config.rating), pero como mucho maxGrowth veces el
   intervalo que tenía, y al menos minDays. Una palabra que volvía a los 10
   días y FSRS mandaría a 30 vuelve a los 15. */
function readingInterval(previousDays, fsrsDays, config) {
  const cap = Math.max(config.minDays, Math.round(Math.max(0, previousDays) * config.maxGrowth));
  return Math.max(config.minDays, Math.min(fsrsDays, cap));
}

/* =========================================
   4. HOY
   -----------------------------------------
   La pantalla de inicio junta lo del día en una lista, en este orden:
     1. un texto con las palabras que tocan (leerlo las repasa; sección 3);
     2. Repasar: las que siguen tocando después del texto, y las nuevas;
     3. unos kanjis que escribir;
     4. unas frases que traducir.
   Lo hecho se deduce de lo que ya se guarda (lecturas terminadas hoy, respuestas
   del día, kanjis escritos y traducciones de hoy): no hace falta guardar nada más.
   ========================================= */

/* Los pasos de hoy.
     s.placed      ha hecho la evaluación inicial (sin ella, solo ese paso)
     s.story       { kind: "text" | "create" | "none", due }: hay un texto que leer o se
                   puede crear uno; due, cuántas palabras que tocan salen en él
     s.read        ha terminado algún texto hoy
     s.due         tarjetas de Repasar que tocan ahora;  s.fresh  nuevas que saldrían
     s.answered    respuestas de hoy en Repasar;  s.goal  la meta diaria
     s.writing     { available, done }: si hay kanji que escribir y cuántos ha escrito hoy
     s.sentences   { available, done }: si hay frases que traducir y cuántas ha traducido hoy
     config        { writing, sentences }: cuántos kanjis y frases por día
   Devuelve { steps: [{ kind, count, done, progress }], next } (next: el primer paso sin hacer). */
function planToday(s, config) {
  if (!s.placed) return { steps: [{ kind: "placement", count: 1, done: false, progress: 0 }], next: "placement" };
  const steps = [];
  if (s.story.kind !== "none" || s.read) steps.push({ kind: "story", count: 1, done: !!s.read, progress: s.read ? 1 : 0, due: s.story.due || 0 });
  // Repasar está hecho cuando no queda nada que toque y ya ha respondido algo hoy
  steps.push({ kind: "reviews", count: s.due + s.fresh, done: s.due === 0 && s.answered > 0, progress: s.answered, due: s.due, fresh: s.fresh });
  if (s.writing.available || s.writing.done) {
    steps.push({ kind: "writing", count: config.writing, done: s.writing.done >= config.writing || !s.writing.available, progress: Math.min(s.writing.done, config.writing) });
  }
  if (s.sentences.available || s.sentences.done) {
    steps.push({ kind: "sentences", count: config.sentences, done: s.sentences.done >= config.sentences || !s.sentences.available, progress: Math.min(s.sentences.done, config.sentences) });
  }
  return { steps, next: steps.find((step) => !step.done)?.kind || null };
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    kanjiGate, writingLevel, nextWritingKanji, writingRating, writingTestResult, writingTestKanji,
    readingCredit, readingInterval, planToday
  };
}
