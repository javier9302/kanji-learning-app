/* =========================================
   KANJI LEARNING APP - translate.js
   Sección "Traducir": se enseña una frase en japonés, el estudiante escribe
   su traducción y se corrige. Las reglas están en translate-core.js; aquí va
   lo que toca al navegador. Se carga después de sentences.js.

   Almacén de IndexedDB:
     translations  un registro por frase respondida:
                   { id, sentenceId, textId, at, answer, answerKey, source, verdict, score, result }
                   Sirve para no repetir frases, para reutilizar una corrección
                   ya hecha y para el resumen. Se queda en el dispositivo.
   ========================================= */

let translationLog = [];   // registros de translations, del más antiguo al más reciente
let translating = null;    // ejercicio en curso: { sentence, lookups: Set(claves), phase, result, session }

async function loadTranslateData() {
  translationLog = (await getAll("translations")).sort((a, b) => a.at - b.at);
}

/* =========================================
   1. QUÉ FRASE TOCA
   ========================================= */

/* Frases que se pueden proponer. Hoy salen de los textos del usuario (y de las
   comunes de la app cuando existan); todo lo demás usa solo esta función, así
   que añadir otra fuente no cambia nada más. */
function translationCandidates() {
  const list = [...userSentences.values()];
  for (const level of staticSentences.values()) list.push(...level);
  return list.filter((sentence) => isTranslatable(sentence, STUDY_CONFIG.translate));
}

/* Lo que se sabe de una palabra para elegir la frase */
function translateWordState(key, known = knownLemmas()) {
  const rec = userWords.get(key);
  const isKnown = isKnownKey(key, known);
  return {
    known: isKnown,
    status: rec?.status || (isKnown ? "mastered" : "unknown"),
    lookups: rec?.lookups || 0,
    failures: (rec?.evalWrong || 0) + (rec?.incorrectCount || 0) + (rec?.meaningWrong || 0)
  };
}

function nextTranslationSentence() {
  const known = knownLemmas();
  const lastSeen = new Map(translationLog.map((entry) => [entry.sentenceId, entry.at]));
  return chooseTranslationSentence({
    candidates: translationCandidates(),
    wordOf: (key) => translateWordState(key, known),
    lastSeenOf: (id) => lastSeen.get(id) || 0,
    lastTextId: translationLog[translationLog.length - 1]?.textId || "",
    now: Date.now()
  }, STUDY_CONFIG.translate);
}
