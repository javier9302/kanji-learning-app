/* De una frase segmentada con "|" a la frase completa que usa la app, en Node:
   kuromoji pone lema, lectura y tipo, y el banco dice qué palabra es cada unidad. */
const { analyseUnits, isKana, UNCOUNTED_POS } = require("../../ja-core.js");
const core = require("../../sentences-core.js");
const { loadBank } = require("./bank.js");
const { loadReadings } = require("./sentences.js");
const { loadTokenizer } = require("./tokenizer.js");

const hiragana = (text) => require("../../ja-core.js").toHiragana(text);
let readings = null;

/* El diccionario general de la app (vendor/jmdict), el mismo que usa en el dispositivo */
let jmdict = null;
function loadJmdict() {
  if (jmdict) return jmdict;
  const fs = require("node:fs"), path = require("node:path");
  const { ROOT } = require("./bank.js");
  const dir = path.join(ROOT, "vendor/jmdict");
  const file = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().pop();
  jmdict = new Map();
  for (const [lemma, reading, meanings] of JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))) {
    if (!jmdict.has(lemma)) jmdict.set(lemma, { lemma, reading: hiragana(reading), meanings });
  }
  return jmdict;
}

/* Lo que se sabe de una palabra por su clave: nivel y si casi siempre va en kana.
   Una palabra del diccionario general (no del banco) tiene el nivel de su kanji
   más difícil: 時 (とき) es N5 porque 時 es un kanji de N5. Sin kanji no tiene
   nivel (las de kana se dan por sabidas). */
function wordOf(key) {
  const BANK = loadBank();
  const word = BANK.words.get(key);
  if (word) return { level: word.level, kana: word.kana };
  const lemma = key.slice(0, key.lastIndexOf("|"));
  if (!loadJmdict().has(lemma)) return null;
  const kanji = [...lemma].filter((c) => /\p{Script=Han}/u.test(c) && c !== "々");
  const levels = kanji.map((c) => BANK.kanjiLevel(c));
  if (!kanji.length) return { level: null, kana: false };
  if (levels.some((level) => !level)) return null; // un kanji fuera del banco: no se sabe su nivel
  return { level: levels.sort((a, b) => BANK.LEVELS.indexOf(b) - BANK.LEVELS.indexOf(a))[0], kana: false };
}
const tagsOf = (key) => core.unpackTags((readings ??= loadReadings())[key] || "");

/* Unidades de una frase segmentada, cada una con la clave de su palabra. Se
   resuelve igual que en la app (texts.js): el banco (también con sus escrituras
   alternativas: 終わる -> 終る), el diccionario general y, en kana, las reglas de ja-core.js. */
async function tokensFor(ja) {
  const BANK = loadBank();
  const tokenizer = await loadTokenizer();
  const { kanaFormWord, onlyHomophone } = require("../../ja-core.js");
  const byReading = new Map();
  for (const word of BANK.words.values()) {
    const r = hiragana(word.r);
    if (!byReading.has(r)) byReading.set(r, []);
    byReading.get(r).push(word);
  }
  return analyseUnits(tokenizer, ja).map((unit) => {
    const token = { surface: unit.surface, lemma: unit.punct ? unit.surface : unit.basic, reading: unit.reading, pos: unit.pos, key: "" };
    // 一人, 一日, 二つ: kuromoji los marca como número, pero son palabras del banco
    if ((unit.pos === "number" || unit.pos === "counter") && BANK.sensesOf(unit.surface)) {
      token.pos = "noun";
      // kuromoji lee mal los números con contador (一人 -> いちにん): con una sola lectura manda la del banco
      if (BANK.sensesOf(unit.surface).length === 1) token.reading = BANK.sensesOf(unit.surface)[0].r;
    }
    if (unit.punct || UNCOUNTED_POS.has(token.pos)) return token;
    if (token.pos === "noun" && BANK.sensesOf(unit.surface)) token.lemma = unit.surface;
    // Un potencial (買える) es su verbo (買う) si el potencial no está en el banco
    const { potentialBase } = require("../../ja-core.js");
    if (token.pos === "verb" && !BANK.sensesOf(token.lemma) && BANK.sensesOf(potentialBase(token.lemma) || "")) token.lemma = potentialBase(token.lemma);
    const senses = BANK.sensesOf(token.surface) || BANK.sensesOf(token.lemma) || [];
    // Si ninguna lectura coincide: la primera escritura del banco; si no, el diccionario general;
    // en kana, la palabra que se escribe así o la única que se lee así
    const dict = loadJmdict().get(token.surface) || loadJmdict().get(token.lemma);
    const kana = isKana(token.lemma) ? kanaFormWord(byReading.get(hiragana(token.lemma))) : null;
    const only = isKana(token.lemma) && !dict ? onlyHomophone(byReading.get(hiragana(token.lemma))) : null;
    const fallback = senses[0]?.id || kana?.id || (dict ? `${dict.lemma}|${dict.reading}` : "") || only?.id ||
      (isKana(token.lemma) ? `${token.lemma}|${hiragana(token.lemma)}` : "");
    token.key = core.resolveKey(token, (form) => BANK.sensesOf(form), fallback);
    return token;
  });
}

/* La frase con la forma común (ver sentences-core.js) */
async function sentenceFrom({ id, ja, en, es, source, sourceId, attribution, fallbackLevel }) {
  return core.buildSentence({ id, tokens: await tokensFor(ja), en, es, source, sourceId, attribution, wordOf, tagsOf, fallbackLevel });
}

module.exports = { tokensFor, sentenceFrom, wordOf, tagsOf };
