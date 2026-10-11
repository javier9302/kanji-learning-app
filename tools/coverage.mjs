/* Informe de cobertura: cuántas frases hay para cada pareja (kanji, lectura)
   que aparece en las palabras del banco. Objetivo: al menos 2 por pareja.
     node tools/coverage.mjs [--extra frases.json …] [--min 2]
   Cuenta las frases publicadas (bank/sentences/*.json) y las de los archivos
   que se pasen con --extra (por ejemplo las exportadas desde la app).
   La lista completa de huecos queda en tools/cache/coverage-gaps.tsv. */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank } = require("./lib/bank.js");
const { cachePath } = require("./lib/cache.js");
const { loadReadings, loadSentences, unpackTags } = require("./lib/sentences.js");

const args = process.argv.slice(2);
const min = Number(args[args.indexOf("--min") + 1]) || 2;
const extra = args.flatMap((arg, i) => args[i - 1] === "--extra" ? [arg] : []);

const BANK = loadBank();
const readings = loadReadings();

// Parejas del banco: en qué palabras salen y el nivel de la más fácil
const pairs = new Map();
for (const word of BANK.words.values()) {
  if (word.kana || !word.kanji.length) continue; // lo que casi siempre va en kana no se estudia
  for (const tag of unpackTags(readings[word.id])) {
    const pair = pairs.get(tag) || { tag, words: [], level: word.level, sentences: 0 };
    pair.words.push(word.id);
    if (BANK.LEVELS.indexOf(word.level) < BANK.LEVELS.indexOf(pair.level)) pair.level = word.level;
    pairs.set(tag, pair);
  }
}

const sentences = [...loadSentences(), ...extra.flatMap((file) => JSON.parse(fs.readFileSync(file, "utf8")))];
for (const sentence of sentences) {
  for (const tag of new Set(sentence.kanjiReadings || [])) if (pairs.has(tag)) pairs.get(tag).sentences++;
}

console.log(`Frases contadas: ${sentences.length}. Parejas (kanji, lectura) en el banco: ${pairs.size}.`);
console.log("Nivel  parejas  con ≥" + min + "  con 1  sin frase  cubiertas");
for (const level of BANK.LEVELS) {
  const list = [...pairs.values()].filter((pair) => pair.level === level);
  const ok = list.filter((pair) => pair.sentences >= min).length;
  const one = list.filter((pair) => pair.sentences > 0 && pair.sentences < min).length;
  console.log(`${level}     ${String(list.length).padStart(7)}  ${String(ok).padStart(6)}  ${String(one).padStart(5)}  ${String(list.length - ok - one).padStart(9)}  ${(list.length ? ok / list.length * 100 : 0).toFixed(1)} %`);
}
const gaps = [...pairs.values()].filter((pair) => pair.sentences < min)
  .sort((a, b) => BANK.LEVELS.indexOf(a.level) - BANK.LEVELS.indexOf(b.level) || b.words.length - a.words.length);
const file = cachePath("coverage-gaps.tsv");
fs.writeFileSync(file, "pareja\tnivel\tfrases\tpalabras\n" +
  gaps.map((pair) => `${pair.tag}\t${pair.level}\t${pair.sentences}\t${pair.words.slice(0, 6).join(" ")}`).join("\n") + "\n");
console.log(`Huecos (menos de ${min} frases): ${gaps.length}. Lista completa en ${file}`);
console.log(`Primeros: ${gaps.slice(0, 15).map((pair) => `${pair.tag.replace("|", "→")} (${pair.sentences})`).join("  ")}`);
