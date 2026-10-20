/* Genera el diccionario general de la app a partir de JMdict (EDRDG, CC BY-SA 4.0):
   las palabras comunes que no están en el banco, con significados en inglés y
   español.   node tools/build-dictionary.mjs
   Escribe vendor/jmdict/common-<versión>.json. Ese archivo lo usa la app sin
   sesión (y sin conexión) y es el que admin.html sube a la tabla "dictionary".
   Al regenerarlo con otra versión, cambia VERSION: el nombre nuevo hace que los
   dispositivos lo descarguen otra vez (el service worker guarda vendor/ para siempre). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank, ROOT } = require("./lib/bank.js");
const { download } = require("./lib/cache.js");
const { parseEntry, buildRows, buildAliases } = require("./lib/jmdict.js");

export const VERSION = "2026-10-20";
const file = await download("http://ftp.edrdg.org/pub/Nihongo/JMdict.gz", "jmdict", `JMdict-${VERSION}.gz`);
const xml = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");

const entries = [];
for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) entries.push(parseEntry(match[1]));

const BANK = loadBank();
const { toHiragana: hiragana } = require("../ja-core.js");
const rows = buildRows(entries, (w, r) => BANK.words.has(BANK.id(w, hiragana(r))));

const out = path.join(ROOT, `vendor/jmdict/common-${VERSION}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "[\n" + rows.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n");
const size = fs.statSync(out).size, gz = zlib.gzipSync(fs.readFileSync(out), { level: 9 }).length;
console.log(`${entries.length} entradas de JMdict; ${rows.length} filas (${rows.filter((r) => r[3].length).length} con español).`);

// Otras escrituras de las palabras del banco (終わる -> 終る): bank/aliases.js
const aliases = buildAliases(entries, [...BANK.words.values()].map((word) => ({ id: word.id, w: word.w, r: hiragana(word.r) })),
  (writing) => BANK.byWriting.has(writing), hiragana);
fs.writeFileSync(path.join(ROOT, "bank/aliases.js"),
`/* Otras escrituras de las palabras del banco: escritura -> id de la palabra.
   Las listas JLPT escriben a veces 終る, 曲る o 御飯; en un texto aparece 終わる,
   曲がる o ご飯, que son la misma palabra. Lo genera tools/build-dictionary.mjs a
   partir de JMdict ${VERSION} (CC BY-SA); no se edita a mano. */
BANK.setAliases(${JSON.stringify(aliases).replace(/","/g, '",\n"').replace(/^\{/, "{\n").replace(/\}$/, "\n}")});
`);
console.log(`Escrito bank/aliases.js: ${Object.keys(aliases).length} escrituras alternativas.`);
console.log(`Escrito ${path.relative(ROOT, out)}: ${(size / 1048576).toFixed(1)} MB, ${(gz / 1024).toFixed(0)} kB con gzip.`);
