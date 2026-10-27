/* =========================================
   KANJI LEARNING APP - story-core.js
   Textos que practican lo que toca repasar y que no se repiten. Sin navegador
   ni datos del usuario alrededor, para poder probarlo con Node. Se carga
   después de ranking-core.js; lo usa reading.js (promptParams y
   generateAndOpen).

   1. Palabras objetivo: las que tocan o van a tocar pronto se le piden a la
      IA; luego se comprueba cuáles salen de verdad en el texto.
   2. Variedad: tipo de texto, tema y personajes van rotando.
   3. Parecido: un texto que repite frases de los últimos se vuelve a pedir.
   Los números vienen de STUDY_CONFIG.stories.
   ========================================= */

const STC_DAY = 86400000;
const stcAddDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * STC_DAY).toISOString().slice(0, 10);

/* =========================================
   1. PALABRAS OBJETIVO
   ========================================= */

/* Lo que se le pide a la IA que use.
     words     [{ id, label, nextReview, studied }]: las palabras del usuario (label: cómo
               se le escribe a la IA, 角(かど))
     kanjiDue  [{ c, nextReview, word: { id, label } | null }]: kanjis cuya tarjeta toca,
               con una palabra que conoce que lo lleva
     day       hoy
     config    { max, soonDays }
   Devuelve [{ id, label, due }]: primero las que tocan (la más atrasada antes),
   después las que tocarán en soonDays días y, si queda sitio, una palabra por
   cada kanji que toca. Sin repetir palabras. */
function storyTargets(words, kanjiDue, day, config) {
  const soon = stcAddDays(day, config.soonDays);
  const byDate = (a, b) => a.nextReview.localeCompare(b.nextReview) || a.id.localeCompare(b.id);
  const studied = words.filter((word) => word.studied && word.nextReview && word.nextReview <= soon).sort(byDate);
  const out = [], seen = new Set();
  const add = (id, label, due) => {
    if (out.length >= config.max || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, due });
  };
  for (const word of studied.filter((w) => w.nextReview <= day)) add(word.id, word.label, true);
  for (const word of studied.filter((w) => w.nextReview > day)) add(word.id, word.label, false);
  for (const kanji of [...kanjiDue].filter((k) => k.word && k.nextReview <= day).sort((a, b) => a.nextReview.localeCompare(b.nextReview))) {
    add(kanji.word.id, kanji.word.label, true);
  }
  return out;
}

/* Cuáles de las pedidas salen en el texto.  lemmas: las claves del texto ({ "名前|なまえ": veces }) */
function targetsFound(targets, lemmas) {
  return targets.filter((target) => lemmas[target.id]).map((target) => target.id);
}

/* =========================================
   2. VARIEDAD
   ========================================= */

/* Lo que toca ahora: el tipo y el tema que hace más que no salen (o nunca), y
   `castSize` personajes de los menos usados.
     history  [{ type, topic, cast: [índices] }] de los últimos textos, el más reciente primero
     types, topics  las listas posibles;  castCount  cuántos personajes hay
   Devuelve { type, topic, cast } */
function nextVariety(history, types, topics, castCount, castSize = 2) {
  const age = (value, key) => {
    const i = history.findIndex((item) => key(item) === value);
    return i < 0 ? Infinity : i;
  };
  const oldest = (list, key) => [...list].sort((a, b) => age(b, key) - age(a, key) || list.indexOf(a) - list.indexOf(b))[0];
  const uses = new Map(Array.from({ length: castCount }, (_, i) => [i, 0]));
  history.forEach((item, position) => {
    // Lo reciente pesa más: los de los últimos textos son los que más se repetirían
    for (const i of item.cast || []) if (uses.has(i)) uses.set(i, uses.get(i) + 1 / (position + 1));
  });
  const cast = [...uses].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, castSize).map(([i]) => i).sort((a, b) => a - b);
  return { type: oldest(types, (item) => item.type), topic: oldest(topics, (item) => item.topic), cast };
}

/* =========================================
   3. PARECIDO CON LOS ÚLTIMOS TEXTOS
   -----------------------------------------
   Por frases, no por palabras sueltas: que salgan ています o ました en todos
   los textos es normal; que salga otra vez 「お腹が空きました」 no. Una frase
   se repite si coincide casi entera (trigramas de caracteres, Jaccard) con
   una frase de los últimos textos.
   ========================================= */

/* Una frase sin puntuación ni espacios */
const stcClean = (sentence) => String(sentence).replace(/[\s|、。！？!?「」『』（）()・…ー〜,.]/g, "");

function stcTrigrams(text) {
  const chars = [...text], grams = new Set();
  for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(""));
  return grams;
}

const stcJaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const gram of a) if (b.has(gram)) common++;
  return common / (a.size + b.size - common);
};

/* sentences: las frases del texto nuevo; recent: las de los últimos textos.
   config: { sentenceMatch, maxShare, maxRepeated }
   Devuelve { repeated: [frases del texto nuevo que ya salieron], share, tooSimilar } */
function textSimilarity(sentences, recent, config) {
  const old = recent.map(stcClean).filter((text) => [...text].length >= 4)
    .map((text) => ({ text, grams: stcTrigrams(text) }));
  const repeated = [];
  let counted = 0;
  for (const sentence of sentences) {
    const text = stcClean(sentence);
    if ([...text].length < 4) continue; // 「はい。」 no dice nada
    counted++;
    const grams = stcTrigrams(text);
    if (old.some((item) => item.text === text || stcJaccard(grams, item.grams) >= config.sentenceMatch)) repeated.push(sentence);
  }
  const share = counted ? repeated.length / counted : 0;
  return { repeated, share, tooSimilar: repeated.length >= config.maxRepeated || share >= config.maxShare };
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { storyTargets, targetsFound, nextVariety, textSimilarity };
}
