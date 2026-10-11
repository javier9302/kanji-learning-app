/* Genera bank/readings.js: qué lectura de cada kanji ejercita cada palabra del banco.
     node tools/build-readings.mjs
   Fuente: JmdictFurigana (https://github.com/Doublevil/JmdictFurigana), que se
   distribuye con la misma licencia que JMdict (CC BY-SA), como el resto del banco.
   Lo que JmdictFurigana no trae se intenta repartir con las lecturas on/kun del
   propio banco. Imprime cuántas palabras se pudieron alinear por nivel. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank, ROOT } = require("./lib/bank.js");
const { download } = require("./lib/cache.js");
const { alignReading, tagsFromFurigana, packTags } = require("../sentences-core.js");

// Versión fija, para que el resultado se pueda repetir. Cámbiala para actualizar.
const VERSION = process.env.JMDICT_FURIGANA_VERSION || "2.3.1+2026-09-25";
const URL = `https://github.com/Doublevil/JmdictFurigana/releases/download/${encodeURIComponent(VERSION)}/JmdictFurigana.txt`;

const BANK = loadBank();
const hiragana = (text) => text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const kanjiInfo = (c) => BANK.kanji.get(c);

/* Cada línea: escritura|lectura|0:がっ;1:こう  (o 0-1:きょう para varios caracteres) */
const file = await download(URL, "jmdict-furigana", `JmdictFurigana-${VERSION}.txt`);
const wanted = new Set([...BANK.words.values()].map((word) => word.w));
const furigana = new Map(); // "escritura|lectura" -> segmentos
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const [text, reading, spec] = line.replace(/^﻿/, "").trim().split("|");
  if (!spec || !wanted.has(text)) continue;
  const chars = [...text], rt = new Array(chars.length).fill(null);
  const segments = [];
  for (const part of spec.split(";")) {
    const [range, sound] = part.split(":");
    const [from, to = from] = range.split("-").map(Number);
    segments.push({ from, to, sound });
  }
  segments.sort((a, b) => a.from - b.from);
  const list = [];
  let at = 0;
  for (const { from, to, sound } of segments) {
    if (from > at) list.push([chars.slice(at, from).join(""), ""]);
    list.push([chars.slice(from, to + 1).join(""), sound]);
    at = to + 1;
  }
  if (at < chars.length) list.push([chars.slice(at).join(""), ""]);
  furigana.set(`${text}|${hiragana(reading)}`, list);
}

const stats = {};
const readings = {};
const unaligned = [];
for (const word of BANK.words.values()) {
  if (!word.kanji.length) continue;
  const level = stats[word.level] ??= { total: 0, furigana: 0, heuristic: 0, whole: 0 };
  level.total++;
  const segments = furigana.get(word.id);
  let tags = segments ? tagsFromFurigana(segments, kanjiInfo) : null;
  if (tags?.length) level.furigana++;
  else {
    tags = alignReading(word.w, word.r, kanjiInfo);
    if (tags?.length) level.heuristic++;
  }
  if (!tags?.length) {
    // Sin reparto: la palabra entera es la unidad (no se inventa una lectura por kanji)
    tags = [`${word.kanji.length === 1 ? word.kanji[0] : word.w}|${hiragana(word.r)}`];
    level.whole++;
    unaligned.push(word.id);
  }
  readings[word.id] = packTags(tags);
}

const body = Object.entries(readings).map(([id, packed]) => `${JSON.stringify(id)}:${JSON.stringify(packed)}`).join(",\n");
fs.writeFileSync(path.join(ROOT, "bank/readings.js"),
`/* Lecturas de kanji que ejercita cada palabra del banco: id -> "学がく,校こう"
   (cada parte es el kanji y su lectura de diccionario; varios kanjis juntos
   cuando se leen como un todo, 今日きょう). Lo genera tools/build-readings.mjs
   a partir de JmdictFurigana ${VERSION} (CC BY-SA, como JMdict); no se edita a mano. */
BANK.setReadings({
${body}
});
`);

console.log("Nivel  palabras  JmdictFurigana  heurística  sin repartir  alineadas");
let total = 0, aligned = 0;
for (const level of BANK.LEVELS) {
  const s = stats[level];
  total += s.total; aligned += s.furigana + s.heuristic;
  console.log(`${level}     ${String(s.total).padStart(7)}  ${String(s.furigana).padStart(14)}  ${String(s.heuristic).padStart(10)}  ${String(s.whole).padStart(12)}  ${((s.furigana + s.heuristic) / s.total * 100).toFixed(1)} %`);
}
console.log(`Total  ${total} palabras con kanji, ${aligned} alineadas (${(aligned / total * 100).toFixed(1)} %).`);
console.log(`Sin repartir (${unaligned.length}): ${unaligned.slice(0, 40).join("  ")}${unaligned.length > 40 ? " …" : ""}`);
