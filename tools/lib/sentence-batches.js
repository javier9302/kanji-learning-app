/* Tandas de frases escritas por una IA (tools/generate-sentences.mjs): el prompt
   y la lectura de la respuesta pegada. Sin archivos ni banco: solo texto, para
   poder probarlo. */

/* Versión del prompt de frases: súbela cada vez que cambies su texto. La función
   generate-sentences lleva una copia de renderSentencePrompt y de esta versión
   (node tools/sync-prompt.mjs); se guarda con cada generación. */
const SENTENCE_PROMPT_VERSION = "2026-10-21.1";

/* El prompt de una tanda.
     batch       nombre de la tanda ("n5-001")
     level       "N5"…
     words       [{ id: "水|みず", w, r, meaning }]
     vocabulary  { levels: ["N5"], words: [...] | null } (null: solo se nombra el nivel)
     perTarget   frases por palabra;  units [mín, máx] sin contar la puntuación */
function renderSentencePrompt({ batch, level, words, vocabulary, perTarget = 2, units = [5, 12] }) {
  const vocabularyLine = vocabulary.words
    ? `- Vocabulary: use ONLY these words (plus particles, auxiliaries, common kana words such as これ, する, いる, ある, とても, numbers and counters). Any other word written with kanji makes the sentence useless:\n${vocabulary.words.join("、")}`
    : `- Vocabulary: only words from JLPT ${vocabulary.levels.join(", ")}. Any other word makes the sentence useless.`;
  const list = words.map((word, i) => `${i + 1}. ${word.id}  — ${word.w} read ${word.r} — "${word.meaning}"`).join("\n");
  return `You are writing example sentences for a Japanese learning app. Learners will see a sentence with ONE word highlighted and type how that word is read, so every sentence must be natural, correct Japanese where the word clearly appears with exactly the reading given.

LEVEL: JLPT ${level}
${vocabularyLine}
- Grammar: no harder than JLPT ${level}.

WORDS (id — writing read reading — meaning)
${list}

TASK
- Write ${perTarget} different sentences for EACH word above.
- Each sentence has between ${units[0]} and ${units[1]} units that are not punctuation.
- Use the word with EXACTLY the reading given (a conjugated form is fine: 行く read いく can appear as 行きました, never as 行った read おこなった). Never use a word with another reading or another meaning: 角 read かど means "corner", so never write 角 meaning "horn".
- Make each sentence meaningful and concrete (a small situation), not a definition and not "This is a ___". The two sentences of a word must be different situations.
- A sentence may also contain one or two OTHER words from the list, used with their given reading; list every word of the list it contains in "targets".
- Write with the kanji a normal text of this level would use; words that are normally written in kana stay in kana (ある, いる, する, できる, ください, たくさん).
- No romaji or other Latin letters, no brackets, no furigana, no names of real people. Japanese quotes 「」 only if they open and close in the same sentence.

SEGMENTATION ("ja" field)
1. "ja" is the sentence with "|" between units. Removing every "|" must give the exact sentence: no spaces, nothing added, nothing dropped.
2. A conjugated verb or adjective is ONE unit together with its endings and auxiliaries (食べています, 高くなかった, 行きましょう).
3. Particles are separate units (は, が, を, に, で, も, と, の, か, ね, よ). です and だ after a noun or adjective are their own unit.
4. Compound words stay together as in a dictionary (毎日, 図書館, 一緒に).
5. Every punctuation mark is its own unit. No empty units: never "||", and no "|" at the start or the end.

OUTPUT
Return ONLY this JSON (no explanations, no markdown), with ${perTarget * words.length} sentences:
{"batch":"${batch}","sentences":[
{"targets":["${words[0].id}"],"ja":"…|…|。","en":"natural English translation","es":"traducción natural al español"}
]}
"targets" uses the ids exactly as written in the list (writing|reading).`;
}

/* Las palabras de una tanda, leídas de su prompt */
const promptTargets = (prompt) => [...prompt.matchAll(/^\d+\. (\S+\|\S+)  —/gm)].map((match) => match[1]);

/* La respuesta tal como se pegó: puede venir envuelta en ```json … ``` o con
   alguna frase alrededor, o ser directamente la lista. Devuelve las frases o
   lanza un error claro. */
function parseResponse(raw) {
  const text = String(raw);
  const start = text.search(/[{[]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  let data;
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch (error) {
    throw new Error(`no es un JSON válido (${error.message}). ¿Se cortó al pegar?`);
  }
  const list = Array.isArray(data) ? data : data?.sentences;
  if (!Array.isArray(list)) throw new Error('falta la lista "sentences".');
  return list;
}

module.exports = { renderSentencePrompt, SENTENCE_PROMPT_VERSION, parseResponse, promptTargets };
