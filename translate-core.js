/* =========================================
   KANJI LEARNING APP - translate-core.js
   Sección "Traducir": las reglas, sin navegador ni datos del usuario alrededor,
   para poder probarlas con Node. Se carga después de sentences-core.js.

   1. Qué frases se pueden proponer y cuál sale (chooseTranslationSentence).
   2. La respuesta: cómo se limpia y cuándo no merece corregirse.
   3. El progreso: qué cambia en las palabras y kanjis (applyTranslationResult).
   Los números (pesos, límites) vienen siempre de STUDY_CONFIG.translate.
   ========================================= */

/* =========================================
   1. ELEGIR LA FRASE
   ========================================= */

/* Unidades que no son vocabulario: la lista está en ja-core.js (en Node se pide con require) */
const TR_UNCOUNTED = typeof module !== "undefined" ? require("./ja-core.js").UNCOUNTED_POS : UNCOUNTED_POS;
const trIsContent = (token) => !TR_UNCOUNTED.has(token.pos);
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
      capped((word) => word.due) * (W.due || 0) +
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

/* =========================================
   3. EL PROGRESO
   -----------------------------------------
   Traducir una frase demuestra que se entiende su SIGNIFICADO, no que se sepa
   leer cada palabra. Por eso aquí nunca se toca el repaso espaciado de la
   lectura (fsrs, nextReview, interval, repetitions…): solo se apunta, aparte,
   lo que se sabe del significado:
     meaningCorrect  puntos seguidos de "la entendió" (un fallo lo pone a 0)
     meaningWrong    veces que no la entendió
     lastMeaningAt   última vez que hubo una cosa o la otra
   ========================================= */

const trKanji = (text) => [...new Set([...text].filter((c) => c !== "々" && /\p{Script=Han}/u.test(c)))];

/* Todas las reglas, en una sola función sin efectos: no guarda nada, devuelve
   los registros ya cambiados para que la pantalla los guarde.
     result    { source, verdict, words: [{ key, lemma, understood: true | false | null }] }
     sentence  la frase (se usan su id y sus unidades)
     state     { wordOf(key)     registro del usuario de esa palabra, o null
                 kanjiOf(c)      registro del usuario de ese kanji, o null
                 readingOf(key)  lectura de la palabra (para crear su registro)
                 wordsWith(c)    registros del usuario de las palabras que llevan ese kanji
                 credited(key)   ¿esta frase ya le sumó a esa palabra otra vez?
                 lookups         Set de claves que tocó mientras respondía
                 now, today      ms y día "AAAA-MM-DD" }
     config    STUDY_CONFIG.translate
   Devuelve { words, kanji, day: { t, tc }, summary: { understood, failed, promoted, looked } } */
function applyTranslationResult(result, sentence, state, config) {
  const credit = config.credit[result.source] ?? 0;
  const changed = new Map(), summary = { understood: [], failed: [], promoted: [], looked: [] };
  const promoted = (rec) => (rec.meaningCorrect || 0) >= config.promoteAt;

  for (const word of result.words || []) {
    if (!word.key || changed.has(word.key)) continue;
    const before = state.wordOf(word.key);
    const [lemma] = word.key.split("|");
    // Una palabra que aún no tenía registro queda como vista, igual que al terminar una lectura
    const rec = before ? { ...before } : {
      id: word.key, lemma, reading: state.readingOf(word.key) || word.key.split("|")[1] || "",
      status: "pre_known", canReadKanji: false, knowsMeaning: false, canWrite: false,
      seen: 1, lookups: 0, evalCorrect: 0, evalWrong: 0, origin: "traducir", firstSeen: state.now
    };
    const looked = state.lookups.has(word.key);
    if (looked) { rec.lookups = (rec.lookups || 0) + 1; summary.looked.push(word.key); }

    if (word.understood === false) {
      rec.meaningWrong = (rec.meaningWrong || 0) + 1;
      rec.meaningCorrect = 0;          // la cuenta de aciertos seguidos vuelve a empezar
      rec.knowsMeaning = false;
      rec.status = "learning";
      rec.lastMeaningAt = state.now;
      summary.failed.push(word.key);
    } else if (word.understood === true && !looked) {
      // Cada frase suma una sola vez por palabra: hacen falta frases distintas
      if (!state.credited(word.key)) rec.meaningCorrect = (rec.meaningCorrect || 0) + credit;
      rec.lastMeaningAt = state.now;
      summary.understood.push(word.key);
      if (promoted(rec) && !rec.knowsMeaning) {
        rec.knowsMeaning = true;
        if (rec.status === "pre_known") rec.status = "mastered";
        summary.promoted.push(word.key);
      }
    } else if (!before && !looked) {
      // Ni entendida ni fallada y sin registro previo: solo queda como vista
    } else if (before && !looked) {
      continue; // null y sin consultar: no cambia nada
    }
    rec.lastSeen = state.now;
    changed.set(word.key, rec);
  }

  // Kanjis: su significado se da por sabido cuando VARIAS palabras distintas que
  // lo llevan se entienden (según la regla de arriba). Una sola no basta.
  const kanji = [];
  const touched = new Set([...changed.keys()].flatMap((key) => trKanji(key.split("|")[0])));
  for (const c of touched) {
    const records = new Map(state.wordsWith(c).map((rec) => [rec.id, rec]));
    for (const [key, rec] of changed) if (key.split("|")[0].includes(c)) records.set(key, rec);
    const support = [...records.values()].filter((rec) => rec.knowsMeaning && promoted(rec)).length;
    const before = state.kanjiOf(c);
    if ((before?.meaningCorrect || 0) === support && (support < config.kanjiWords || before?.knowsMeaning)) continue;
    const rec = before ? { ...before } : { id: c, status: "unknown", knowsMeaning: false, canWrite: false, writes: 0, firstSeen: state.now };
    rec.meaningCorrect = support;      // en un kanji: cuántas palabras lo respaldan
    if (support >= config.kanjiWords) rec.knowsMeaning = true;
    rec.lastMeaningAt = rec.lastSeen = state.now;
    kanji.push(rec);
  }

  const good = result.verdict === "correct" || result.verdict === "mostly";
  return { words: [...changed.values()], kanji, day: { t: 1, tc: good ? 1 : 0 }, summary };
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    isTranslatable, chooseTranslationSentence, trContentKeys, trLength, normalizeAnswer, answerProblem, localResult,
    answerWords, compareWithReference, matchesReference, answerKey, applyTranslationResult
  };
}
