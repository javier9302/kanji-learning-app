/* Tamaño de lo que descarga la app para las frases: en bruto y comprimido con
   gzip (lo que viaja por la red), y lo que tarda en montarse el índice
   palabra -> frases.   node tools/size-report.mjs */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROOT, loadBank } = require("./lib/bank.js");
const { sentenceFile } = require("./lib/sentences.js");

const kb = (bytes) => `${(bytes / 1024).toFixed(1).padStart(8)} kB`;
const files = ["bank/readings.js", "sentences-core.js", "sentences.js", "ja-core.js", "dictionary.js",
  ...loadBank().LEVELS.map((level) => path.relative(ROOT, sentenceFile(level)))];

console.log("Archivo                         bruto         gzip   frases");
let raw = 0, zipped = 0, all = [];
for (const file of files) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log(`${file.padEnd(28)}  (no existe todavía)`); continue; }
  const data = fs.readFileSync(full), gz = zlib.gzipSync(data, { level: 9 }).length;
  const list = file.endsWith(".json") ? JSON.parse(data) : null;
  if (list) all.push(...list);
  raw += data.length; zipped += gz;
  console.log(`${file.padEnd(28)} ${kb(data.length)}  ${kb(gz)}   ${list ? list.length : ""}`);
}
console.log(`${"Total".padEnd(28)} ${kb(raw)}  ${kb(zipped)}   ${all.length}`);

if (all.length) {
  const start = performance.now();
  const index = new Map();
  for (const sentence of all) for (const target of sentence.targets || []) {
    if (!index.has(target)) index.set(target, []);
    index.get(target).push(sentence);
  }
  console.log(`Índice palabra -> frases: ${index.size} palabras, ${(performance.now() - start).toFixed(1)} ms (se calcula una vez y se guarda en memoria).`);
}
