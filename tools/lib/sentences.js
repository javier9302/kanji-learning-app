/* Frases estáticas ya publicadas (bank/sentences/<nivel>.json) y lecturas de
   kanji del banco (bank/readings.js), para las herramientas. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, loadBank } = require("./bank.js");
const { unpackTags } = require("../../sentences-core.js");

const SENTENCE_DIR = path.join(ROOT, "bank/sentences");
const sentenceFile = (level) => path.join(SENTENCE_DIR, `${level.toLowerCase()}.json`);

function loadReadings() {
  let readings = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "bank/readings.js"), "utf8"),
    { BANK: { setReadings: (value) => { readings = value; } } });
  return readings;
}

/* Todas las frases publicadas, de todos los niveles */
function loadSentences() {
  const list = [];
  for (const level of loadBank().LEVELS) {
    if (fs.existsSync(sentenceFile(level))) list.push(...JSON.parse(fs.readFileSync(sentenceFile(level), "utf8")));
  }
  return list;
}

module.exports = { SENTENCE_DIR, sentenceFile, loadReadings, loadSentences, unpackTags };
