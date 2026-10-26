/* =========================================
   KANJI LEARNING APP - ranking-core.js
   Qué palabra nueva conviene aprender ahora, con lo que el estudiante ya sabe
   de cada kanji (kanji-core.js). Sin navegador ni datos del usuario alrededor,
   para poder probarlo con Node. Se carga después de kanji-core.js; lo usa
   study.js (newWordCandidates).

   Cada palabra recibe una puntuación por componentes, de 0 a 1 (el puente
   puede restar), multiplicados por su peso de STUDY_CONFIG.ranking.weights:
     frequency  su puesto en la lista de frecuencia (la columna vertebral)
     bridge     i+1: lo mejor es UNA cosa nueva, un kanji nuevo junto a kanjis
                conocidos o una lectura nueva de un kanji conocido. Quien conoce
                名前 aprende bien 有名 (有 nuevo y la lectura めい de 名) o 前置き
                (前 まえ conocido, 置 nuevo); dos kanjis nuevos o más restan
     unlock     cuánto vocabulario frecuente abre el kanji nuevo que trae
     coverage   le da a un kanji parcial una lectura que le faltaba (más si es
                la última)
     topic      parecido a lo que ha aprendido hace poco (fase D; de momento 0)
   Después, MMR (relevancia marginal máxima) reordena las primeras para que no
   salgan seguidas varias con el mismo kanji nuevo o la misma lectura nueva.
   ========================================= */

// frequencyWeight está en kanji-core.js (en Node se pide con require)
const rcWeight = typeof module !== "undefined" ? require("./kanji-core.js").frequencyWeight : frequencyWeight;

/* El contexto del estudiante, a partir de kanjiStates (kanji-core.js).
     states        Map carácter -> { state, meaning, known, missing }
     unknownWords  [{ pairs, kanji, rank }]: las palabras que aún no conoce (para el valor
                   de desbloqueo)
   Devuelve { knownKanji: Set, seen: Map c -> Set(lecturas), missing: Map c -> Set,
   kanjiValue: Map c -> suma de frequencyWeight de las palabras sin conocer que lo llevan } */
function rankingContext(states, unknownWords) {
  const knownKanji = new Set(), seen = new Map(), missing = new Map();
  for (const [c, state] of states) {
    if (state.state !== "unknown" || state.meaning) knownKanji.add(c);
    if (state.known?.length) seen.set(c, new Set(state.known));
    if (state.state === "partial" && state.missing?.length) missing.set(c, new Set(state.missing));
  }
  const kanjiValue = new Map();
  for (const word of unknownWords) {
    const weight = rcWeight(word.rank);
    if (!weight) continue;
    for (const c of word.kanji) kanjiValue.set(c, (kanjiValue.get(c) || 0) + weight);
  }
  return { knownKanji, seen, missing, kanjiValue };
}

/* Lo nuevo de una palabra.  word: { kanji: [c], pairs: [[c, lectura]] }
   Devuelve { newKanji: [c], newReadings: [[c, lectura]], knownKanji: [c], completes: [[c, lectura]] }
     newReadings  lecturas que no ha visto de kanjis que ya conoce
     completes    las que le faltaban a un kanji parcial (lectura relevante sin ver) */
function wordNovelty(word, ctx) {
  const newKanji = [...new Set(word.kanji.filter((c) => !ctx.knownKanji.has(c)))];
  const knownKanji = [...new Set(word.kanji.filter((c) => ctx.knownKanji.has(c)))];
  const newReadings = [], completes = [];
  const done = new Set();
  for (const [c, reading] of word.pairs || []) {
    const key = `${c}|${reading}`;
    if (!ctx.knownKanji.has(c) || done.has(key) || ctx.seen.get(c)?.has(reading)) continue;
    done.add(key);
    newReadings.push([c, reading]);
    if (ctx.missing.get(c)?.has(reading)) completes.push([c, reading]);
  }
  return { newKanji, newReadings, knownKanji, completes };
}

/* El puente (i+1) según cuántas cosas nuevas trae. config: STUDY_CONFIG.ranking.bridge */
function bridgeScore({ newKanji, newReadings }, config) {
  if (newKanji.length >= 2) return config.twoKanji;
  if (newKanji.length === 1) return newReadings.length === 0 ? config.one : newReadings.length === 1 ? config.kanjiAndReading : config.many;
  if (newReadings.length === 0) return config.nothingNew;
  return newReadings.length === 1 ? config.one : config.readingsOnly;
}

/* Puntúa las palabras.
     words   [{ id, kanji, pairs, rank }]
     ctx     rankingContext
     config  STUDY_CONFIG.ranking (+ frequencyMaxRank)
   Devuelve [{ id, score, parts: { frequency, bridge, unlock, coverage, topic }, novelty }]
   en el mismo orden. topicOf(id) -> 0..1 (fase D). */
function scoreRanking(words, ctx, config, topicOf = () => 0) {
  const unlockRaw = words.map((word) => {
    const novelty = wordNovelty(word, ctx);
    // Lo que abre cada kanji nuevo, sin contar esta misma palabra
    const raw = novelty.newKanji.reduce((sum, c) => sum + Math.max(0, (ctx.kanjiValue.get(c) || 0) - rcWeight(word.rank)), 0);
    return { novelty, raw };
  });
  const maxRaw = Math.max(0, ...unlockRaw.map((item) => item.raw));
  const W = config.weights;
  return words.map((word, i) => {
    const { novelty, raw } = unlockRaw[i];
    const parts = {
      frequency: word.rank ? Math.max(0, 1 - (word.rank - 1) / config.frequencyMaxRank) : 0,
      bridge: word.kanji.length ? bridgeScore(novelty, config.bridge) : 0,
      unlock: maxRaw ? Math.log1p(raw) / Math.log1p(maxRaw) : 0,
      coverage: Math.min(1, novelty.completes.reduce((sum, [c]) => sum + (ctx.missing.get(c).size === novelty.completes.filter(([k]) => k === c).length ? 1 : 0.5), 0)),
      topic: topicOf(word.id)
    };
    const score = Object.entries(parts).reduce((sum, [key, value]) => sum + (W[key] || 0) * value, 0);
    return { id: word.id, score, parts, novelty };
  });
}

/* Parecido entre dos palabras para la diversidad: 1 si traen el mismo kanji nuevo
   o la misma lectura nueva; 0,5 si comparten algún kanji; si no, 0. Las claves de
   cada palabra se calculan una vez: MMR compara cada una con muchas. */
const rcKeys = new WeakMap();
function rcKeysOf(item) {
  if (!rcKeys.has(item)) {
    const { newKanji, newReadings, knownKanji } = item.novelty;
    rcKeys.set(item, { fresh: new Set([...newKanji, ...newReadings.map(([c, r]) => `${c}|${r}`)]), all: new Set([...newKanji, ...knownKanji]) });
  }
  return rcKeys.get(item);
}
function noveltySimilarity(a, b) {
  const ka = rcKeysOf(a), kb = rcKeysOf(b);
  for (const key of kb.fresh) if (ka.fresh.has(key)) return 1;
  for (const c of kb.all) if (ka.all.has(c)) return 0.5;
  return 0;
}

/* MMR: de las `pool` primeras (ya ordenadas por puntuación), elige cada vez la que
   más vale menos lo que se parece a las ya elegidas:
     λ · relevancia - (1 - λ) · máximo parecido con las elegidas
   La relevancia es la puntuación llevada a 0..1 dentro del grupo. Las demás van
   detrás, en su orden. similarity(a, b) -> 0..1. */
function diversify(sorted, { lambda, pool }, similarity = noveltySimilarity) {
  const head = sorted.slice(0, pool), tail = sorted.slice(pool);
  if (head.length < 3) return sorted;
  const top = head[0].score, bottom = head[head.length - 1].score;
  const relevance = (item) => top > bottom ? (item.score - bottom) / (top - bottom) : 1;
  const picked = [], left = [...head];
  const closest = new Map(left.map((item) => [item, 0])); // parecido máximo con lo elegido
  while (left.length) {
    let best = 0, bestValue = -Infinity;
    left.forEach((item, i) => {
      const value = lambda * relevance(item) - (1 - lambda) * closest.get(item);
      if (value > bestValue) { best = i; bestValue = value; }
    });
    const [chosen] = left.splice(best, 1);
    chosen.mmr = bestValue;
    picked.push(chosen);
    for (const item of left) closest.set(item, Math.max(closest.get(item), similarity(item, chosen)));
  }
  return [...picked, ...tail];
}

/* Por qué sale una palabra, en piezas para traducir: [[clave, datos]]
   (las traduce study.js). Primero lo nuevo, luego lo conocido y el tema. */
function rankingReasons(item, config) {
  const { newKanji, newReadings, knownKanji, completes } = item.novelty;
  const reasons = [];
  const completing = new Set(completes.map(([c, r]) => `${c}|${r}`));
  for (const [c, reading] of newReadings) {
    reasons.push([completing.has(`${c}|${reading}`) ? "completes" : "newReading", { kanji: c, reading }]);
  }
  if (newKanji.length >= 2) reasons.push(["manyKanji", { n: newKanji.length, kanji: newKanji.join("、") }]);
  else if (newKanji.length === 1) reasons.push([item.parts.unlock >= config.unlockShown ? "newKanjiUnlocks" : "newKanji", { kanji: newKanji[0] }]);
  const known = knownKanji.filter((c) => !newReadings.some(([k]) => k === c));
  if (known.length) reasons.push(["knownKanji", { kanji: known.join("、") }]);
  if (!newKanji.length && !newReadings.length && knownKanji.length) reasons.push(["nothingNew", {}]);
  return reasons;
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { rankingContext, wordNovelty, bridgeScore, scoreRanking, noveltySimilarity, diversify, rankingReasons };
}
