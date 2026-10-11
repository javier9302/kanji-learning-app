/* =========================================
   KANJI LEARNING APP - translate-core.js
   Sección "Traducir": las reglas, sin navegador ni datos del usuario alrededor,
   para poder probarlas con Node. Se carga después de sentences-core.js.

   1. Qué frases se pueden proponer y cuál sale (chooseTranslationSentence).
   2. La respuesta: cómo se limpia y cuándo no merece corregirse.
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

/* =========================================
   2. LA RESPUESTA
   ========================================= */

/* Deja la respuesta lista para enviarla: sin caracteres de control, con los
   espacios seguidos reducidos a uno, sin espacios en los extremos y recortada
   al máximo. */
function normalizeAnswer(text, max = 100) {
  const clean = String(text ?? "").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim();
  return [...clean].slice(0, max).join("").trim();
}

/* Por qué una respuesta no se puede corregir: "empty", "short" o "" si vale.
   Se comprueba en el dispositivo: no gasta ninguna llamada a la IA. */
function answerProblem(answer, config) {
  if (!answer) return "empty";
  return (answer.match(/\p{L}/gu) || []).length < config.answerMinLetters ? "short" : "";
}

/* ---------- Comparación con la traducción de referencia (sin IA) ---------- */

/* Palabras que casi no cambian el significado. Es una lista corta a propósito:
   negaciones, números, pronombres y verbos auxiliares NO están, porque quitarlos
   daría por buena una respuesta que dice lo contrario, otro número, otra
   persona u otro tiempo. */
const TR_STOPWORDS = new Set(("el la los las un una unos unas de del al a que y " +
  "the an of to and that").split(" "));

/* Texto -> lista de palabras comparables: minúsculas, sin acentos ni puntuación,
   con las contracciones inglesas deshechas (don't -> do not) */
function answerWords(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\bcan't\b/g, "can not").replace(/\bwon't\b/g, "will not").replace(/n't\b/g, " not")
    .replace(/[’']s\b/g, " is").replace(/[’']m\b/g, " am").replace(/[’']re\b/g, " are")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

/* Parecido entre la respuesta y una referencia, de 0 a 1. Cuenta las palabras
   que coinciden EN EL MISMO ORDEN (subsecuencia común más larga) sobre la más
   larga de las dos, así que ni sobrar ni faltar palabras sale gratis y
   "el perro mordió al hombre" no vale por "el hombre mordió al perro". */
function compareWithReference(answer, reference) {
  const a = answerWords(answer).filter((word) => !TR_STOPWORDS.has(word));
  const b = answerWords(reference).filter((word) => !TR_STOPWORDS.has(word));
  if (!a.length || !b.length) return 0;
  let row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const next = [0];
    for (let j = 1; j <= b.length; j++) next[j] = a[i - 1] === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    row = next;
  }
  return row[b.length] / Math.max(a.length, b.length);
}

/* ¿Se puede dar por buena sin IA? Compara con la referencia en los dos idiomas */
function matchesReference(answer, sentence, config) {
  return [sentence.es, sentence.en].some((reference) => !!reference &&
    answerWords(reference).filter((word) => !TR_STOPWORDS.has(word)).length >= config.localMinWords &&
    compareWithReference(answer, reference) >= config.localMatch);
}

/* Clave para reconocer una respuesta ya corregida: la frase y la respuesta sin
   mayúsculas, acentos ni puntuación (aquí no se quita ninguna palabra) */
const answerKey = (sentenceId, answer) => `${sentenceId}\n${answerWords(answer).join(" ")}`;

/* Resultado hecho en el dispositivo (sin IA), con la misma forma que el de la IA:
     source   "self" (el estudiante se corrige), "unknown" (No lo sé), "local" (coincide con la referencia)
     verdict  "correct" | "mostly" | "partial" | "incorrect"
   Todas las palabras de la frase quedan igual: entendidas, no entendidas, o sin
   saber (null) cuando el estudiante dice que la entendió solo en parte. */
function localResult(sentence, source, verdict) {
  const understood = verdict === "correct" || verdict === "mostly" ? true : verdict === "incorrect" ? false : null;
  const seen = new Set(), words = [];
  for (const token of sentence.tokens) {
    if (!trIsContent(token) || seen.has(token.key)) continue;
    seen.add(token.key);
    words.push({ lemma: token.lemma, key: token.key, understood, note: "" });
  }
  return {
    source, verdict, score: { correct: 100, mostly: 80, partial: 50, incorrect: 0 }[verdict],
    feedback: "", better: "", grammar_note: "", words
  };
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    isTranslatable, chooseTranslationSentence, trContentKeys, trLength, normalizeAnswer, answerProblem, localResult,
    answerWords, compareWithReference, matchesReference, answerKey
  };
}
