/* De una frase segmentada con "|" a la frase completa que usa la app, en Node:
   kuromoji pone lema, lectura y tipo, y el banco dice qué palabra es cada unidad. */
const { analyseUnits, isKana } = require("../../ja-core.js");
const core = require("../../sentences-core.js");
const { loadBank } = require("./bank.js");
const { loadReadings } = require("./sentences.js");
const { loadTokenizer } = require("./tokenizer.js");

const hiragana = (text) => text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
let readings = null;

/* Lo que se sabe de una palabra por su clave: nivel y si casi siempre va en kana */
function wordOf(key) {
  const word = loadBank().words.get(key);
  return word ? { level: word.level, kana: word.kana } : null;
}
const tagsOf = (key) => core.unpackTags((readings ??= loadReadings())[key] || "");

/* Unidades de una frase segmentada, cada una con la clave de su palabra */
async function tokensFor(ja) {
  const BANK = loadBank();
  const tokenizer = await loadTokenizer();
  return analyseUnits(tokenizer, ja).map((unit) => {
    const token = { surface: unit.surface, lemma: unit.punct ? unit.surface : unit.basic, reading: unit.reading, pos: unit.pos, key: "" };
    if (unit.punct || ["particle", "auxiliary", "symbol", "number", "proper_noun"].includes(unit.pos)) return token;
    // Si ninguna lectura coincide: la única palabra con esa escritura, o la propia palabra en kana
    const senses = BANK.byWriting.get(token.lemma) || BANK.byWriting.get(token.surface) || [];
    const fallback = senses[0]?.id || (isKana(token.lemma) ? `${token.lemma}|${hiragana(token.lemma)}` : "");
    token.key = core.resolveKey(token, (form) => BANK.byWriting.get(form), fallback);
    return token;
  });
}

/* La frase con la forma común (ver sentences-core.js) */
async function sentenceFrom({ id, ja, en, es, source, sourceId, attribution, fallbackLevel }) {
  return core.buildSentence({ id, tokens: await tokensFor(ja), en, es, source, sourceId, attribution, wordOf, tagsOf, fallbackLevel });
}

module.exports = { tokensFor, sentenceFrom, wordOf, tagsOf };
