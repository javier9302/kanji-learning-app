/* =========================================
   KANJI LEARNING APP - translate-core.js
   Sección "Traducir": las reglas, sin navegador ni datos del usuario alrededor,
   para poder probarlas con Node. Se carga después de sentences-core.js.

   1. Qué frases se pueden proponer y cuál sale (chooseTranslationSentence).
   Los números (pesos, límites) vienen siempre de STUDY_CONFIG.translate.
   ========================================= */

/* =========================================
   1. ELEGIR LA FRASE
   ========================================= */

const trIsContent = (token) => !["particle", "auxiliary", "punctuation", "symbol", "number", "proper_noun"].includes(token.pos);
const trIsPunct = (token) => token.pos === "punctuation" || token.pos === "symbol";
/* Caracteres japoneses de la frase, sin la puntuación */
const trLength = (sentence) => [...sentence.tokens.filter((token) => !trIsPunct(token)).map((token) => token.surface).join("")].length;
/* Palabras con contenido de la frase, cada una una vez */
const trContentKeys = (sentence) => [...new Set(sentence.tokens.filter(trIsContent).map((token) => token.key))];

/* ¿Se puede proponer esta frase para traducir? Hace falta una traducción de
   referencia (las de un texto pegado no la tienen), que no sea ni muy corta ni
   muy larga, y que todas sus palabras con contenido estén resueltas. */
function isTranslatable(sentence, config) {
  if (!(sentence.en || sentence.es) || !sentence.tokens?.length) return false;
  const length = trLength(sentence);
  if (length < config.minChars || length > config.maxChars) return false;
  const content = sentence.tokens.filter(trIsContent);
  return content.length > 0 && content.every((token) => !!token.key);
}

/* La frase que toca traducir, o null si no hay ninguna.
   state:
     candidates   frases (se filtran aquí con isTranslatable)
     wordOf       key -> { known, status, lookups, failures }: lo que se sabe de cada
                  palabra del usuario (known: cuenta como conocida al leer)
     lastSeenOf   id de frase -> cuándo salió por última vez en Traducir (ms) o 0
     lastTextId   texto de la frase anterior, para repartir entre textos
     now          ms
   config: STUDY_CONFIG.translate
   Se prefieren las frases en las que casi todo se conoce (como mucho una o dos
   palabras sin conocer), con palabras que el usuario está aprendiendo, ha
   consultado o ha fallado, que no hayan salido hace poco y de otro texto. */
function chooseTranslationSentence(state, config) {
  const W = config.choose, DAY = 86400000;
  let best = null;
  for (const sentence of state.candidates || []) {
    if (!isTranslatable(sentence, config)) continue;
    const keys = trContentKeys(sentence);
    const words = keys.map((key) => state.wordOf(key) || {});
    const unknown = words.filter((word) => !word.known).length;
    if (unknown > config.maxUnknown) continue;

    const capped = (test) => Math.min(W.perWordMax, words.filter(test).length);
    const seen = state.lastSeenOf?.(sentence.id) || 0;
    const age = seen ? Math.max(0, (state.now - seen) / DAY) : Infinity;
    const score =
      (keys.length - unknown) / keys.length * W.known +
      (W.unknown[unknown] ?? 0) +
      capped((word) => word.status === "learning" || word.status === "pre_known") * W.learning +
      capped((word) => word.lookups > 0) * W.lookups +
      capped((word) => word.failures > 0) * W.failed -
      (age < W.recentDays ? W.recent * (1 - age / W.recentDays) : 0) -
      (state.lastTextId && sentence.sourceId === state.lastTextId ? W.sameText : 0);

    // A igualdad: la que hace más que no sale y, por último, un orden fijo
    if (!best || score > best.score || score === best.score &&
        (seen < best.seen || seen === best.seen && sentence.id < best.sentence.id)) {
      best = { sentence, score, seen };
    }
  }
  return best ? best.sentence : null;
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { isTranslatable, chooseTranslationSentence, trContentKeys, trLength };
}
