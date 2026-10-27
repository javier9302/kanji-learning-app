/* Genera bank/kanji-info.js: lo que hace falta para saber qué se sabe de cada
   kanji a partir de las palabras (kanji-core.js) y para la tabla de kanjis.
     node tools/build-kanji.mjs
   Por cada kanji: nivel JLPT, grado escolar, frecuencia en prensa y trazos (KANJIDIC2),
   su importancia (cuánto vocabulario frecuente abre) y sus lecturas en las
   palabras del banco, con cuántas palabras usa cada una.
   Fuentes: KANJIDIC2 (EDRDG, CC BY-SA 4.0) y bank/readings.js (JmdictFurigana).
   KANJIDIC2 se descarga de edrdg.org; si no se puede, de la copia en JSON del
   paquete de npm kanjidic2-json (KANJIDIC2_SOURCE=npm la elige directamente).
   Necesita que bank/readings.js esté al día (tools/build-readings.mjs). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank, ROOT } = require("./lib/bank.js");
const { download } = require("./lib/cache.js");
const { kanjiVariants, unpackTags } = require("../sentences-core.js");
const { normalizeKanjiReading, frequencyWeight, wordSounds, wordKanjiReadings } = require("../kanji-core.js");

const XML_URL = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz";
const NPM_VERSION = "0.1.0";
const NPM_URL = `https://registry.npmjs.org/kanjidic2-json/-/kanjidic2-json-${NPM_VERSION}.tgz`;

const BANK = loadBank();
vm.runInContext(fs.readFileSync(path.join(ROOT, "bank/readings.js"), "utf8"), vm.createContext({ BANK }));

/* ---------- KANJIDIC2: carácter -> { grade, freq, on, kun, en, es } ---------- */

const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function fromXML(xml) {
  const out = new Map();
  for (const [, body] of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
    const all = (re) => [...body.matchAll(re)].map((m) => decode(m[1]));
    const c = body.match(/<literal>(.*?)<\/literal>/)[1];
    out.set(c, {
      grade: Number(body.match(/<grade>(\d+)<\/grade>/)?.[1]) || null,
      strokes: Number(body.match(/<stroke_count>(\d+)<\/stroke_count>/)?.[1]) || null,
      freq: Number(body.match(/<freq>(\d+)<\/freq>/)?.[1]) || null,
      on: all(/<reading r_type="ja_on">(.*?)<\/reading>/g), kun: all(/<reading r_type="ja_kun">(.*?)<\/reading>/g),
      en: all(/<meaning>(.*?)<\/meaning>/g), es: all(/<meaning m_lang="es">(.*?)<\/meaning>/g)
    });
  }
  return { kanji: out, source: `KANJIDIC2 ${xml.match(/<date_of_creation>(.*?)</)?.[1] || ""}`.trim() };
}

/* Un archivo de un .tgz (el tar es sencillo: cabeceras de 512 bytes) */
function fromTgz(buffer, wanted) {
  const tar = zlib.gunzipSync(buffer);
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar.toString("utf8", at, at + 100).replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.toString("utf8", at + 124, at + 136).replace(/\0.*$/s, "").trim(), 8) || 0;
    if (name.endsWith(wanted)) return tar.subarray(at + 512, at + 512 + size).toString("utf8");
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} no está en el paquete`);
}

function fromJSON(list) {
  return {
    kanji: new Map(list.map((k) => [k.literal, {
      grade: k.grade || null, freq: k.freq || null, strokes: k.strokeCounts?.[0] || null, on: k.readings?.ja_on || [], kun: k.readings?.ja_kun || [],
      en: k.meanings?.en || [], es: k.meanings?.es || []
    }])),
    source: `KANJIDIC2 (copia de kanjidic2-json ${NPM_VERSION})`
  };
}

async function loadKanjidic() {
  if (process.env.KANJIDIC2_SOURCE !== "npm") {
    try {
      const file = await download(XML_URL, "kanjidic2", "kanjidic2.xml.gz");
      return fromXML(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
    } catch (error) {
      console.error(`No se pudo usar ${XML_URL} (${error.message}); se usa la copia de npm.`);
    }
  }
  const file = await download(NPM_URL, "kanjidic2", `kanjidic2-json-${NPM_VERSION}.tgz`);
  return fromJSON(JSON.parse(fromTgz(fs.readFileSync(file), "KANJIS.json")));
}

const { kanji: KD, source } = await loadKanjidic();

/* ---------- Las lecturas de cada kanji en las palabras del banco ---------- */

const levelOf = (c) => BANK.kanji.get(c)?.level || BANK.kanjiLevels[c] || null;
const infoOf = (c) => KD.get(c) || BANK.kanji.get(c);
const stats = new Map(); // carácter -> { readings: Map lectura -> [palabras, lista], weight }
const overrides = {};    // id -> lecturas de sus kanjis, cuando no son las de sus etiquetas
const special = [], unmatched = [];
const entry = (c) => stats.get(c) || stats.set(c, { readings: new Map(), weight: 0 }).get(c);

for (const word of BANK.words.values()) {
  if (word.kana || !word.kanji.length) continue;
  const rank = BANK.frequency[word.id] || 0;
  for (const c of word.kanji) entry(c).weight += frequencyWeight(rank);
  // Lo que suena cada kanji en la palabra (上手: じょう, no la しょう de la etiqueta)
  const tags = unpackTags(BANK.readings[word.id]);
  const sounds = wordSounds(word.w, word.r, tags, (c) => kanjiVariants(infoOf(c)));
  if (!sounds) unmatched.push(word.id);
  const parts = sounds ? sounds.filter(([, , tag]) => tag).map(([, sound, tag]) => [tag.split("|")[0], sound])
    : tags.map((tag) => tag.split("|"));
  const pairs = [];
  for (const [c, sound] of parts) {
    if ([...c].length !== 1) continue; // 今日きょう: la palabra entera, no una lectura del kanji
    const reading = normalizeKanjiReading(sound, infoOf(c), kanjiVariants);
    if (!reading) { special.push(`${word.w} ${c}|${sound}`); continue; }
    pairs.push([c, reading]);
    const counts = entry(c).readings.get(reading) || [0, 0];
    counts[0]++;
    if (rank) counts[1]++;
    entry(c).readings.set(reading, counts);
  }
  const packed = pairs.map(([c, reading]) => c + reading).join(",");
  if (packed !== wordKanjiReadings(tags).map(([c, reading]) => c + reading).join(",")) overrides[word.id] = packed;
}

/* Los kanjis de la tabla: los del banco, los de sus palabras y los de uso común (grados 1 a 8) */
const chars = new Set([...BANK.kanji.keys(), ...stats.keys()]);
for (const [c, info] of KD) if (info.grade >= 1 && info.grade <= 8) chars.add(c);

// Importancia: puesto según cuánto vocabulario frecuente abre; sin él, por frecuencia en prensa
const importance = [...chars].filter((c) => stats.get(c)?.weight > 0)
  .sort((a, b) => stats.get(b).weight - stats.get(a).weight || (KD.get(a)?.freq || 9999) - (KD.get(b)?.freq || 9999));
const rest = [...chars].filter((c) => !(stats.get(c)?.weight > 0) && KD.get(c)?.freq).sort((a, b) => KD.get(a).freq - KD.get(b).freq);
const rankOf = new Map([...importance, ...rest].map((c, i) => [c, i + 1]));

const rows = [...chars].sort((a, b) => (rankOf.get(a) || 1e9) - (rankOf.get(b) || 1e9) || a.localeCompare(b)).map((c) => {
  const kd = KD.get(c) || {};
  const item = stats.get(c);
  const readings = item ? [...item.readings].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).map(([r, [words, list]]) => [r, words, list]) : [];
  const row = [levelOf(c), kd.grade || 0, kd.freq || 0, rankOf.get(c) || 0, readings, kd.strokes || 0];
  // Los que no están en el banco llevan su significado y sus lecturas (para la ficha)
  if (!BANK.kanji.has(c)) row.push(kd.en?.slice(0, 4) || [], kd.es?.slice(0, 4) || [], kd.on || [], kd.kun || []);
  return `${JSON.stringify(c)}:${JSON.stringify(row)}`;
});

const fixes = Object.entries(overrides).map(([id, packed]) => `${JSON.stringify(id)}:${JSON.stringify(packed)}`);
fs.writeFileSync(path.join(ROOT, "bank/kanji-info.js"),
`/* Información de cada kanji para la tabla de kanjis y su estado (kanji-core.js).
   Kanjis: carácter -> [nivel JLPT, grado escolar (1-6, 8 secundaria, 9-10 nombres; 0 sin grado),
   frecuencia en prensa (0 sin dato), importancia (puesto por el vocabulario frecuente que abre),
   lecturas [[lectura, palabras del banco, de ellas en la lista de frecuencia]], trazos (0 sin dato)
   (y, si el kanji no está en el banco: significados en/es, on, kun)].
   Palabras: id -> las lecturas de sus kanjis cuando no son las de bank/readings.js
   (上手 -> "上じょう,手ず"; "" si no ejercita ninguna, お兄さん).
   Lo genera tools/build-kanji.mjs a partir de ${source} (EDRDG, CC BY-SA 4.0) y
   bank/readings.js (JmdictFurigana, CC BY-SA); no se edita a mano. */
BANK.setKanjiInfo({
${rows.join(",\n")}
}, {
${fixes.join(",\n")}
});
`);

const byLevel = {};
for (const c of chars) byLevel[levelOf(c) || "otros"] = (byLevel[levelOf(c) || "otros"] || 0) + 1;
console.log(`${chars.size} kanjis (${Object.entries(byLevel).map(([k, v]) => `${k} ${v}`).join(", ")}), fuente: ${source}.`);
console.log(`Palabras con las lecturas de sus kanjis corregidas: ${fixes.length}. Sin encajar con sus etiquetas: ${unmatched.length} ${unmatched.slice(0, 15).join("  ")}`);
console.log(`Lecturas especiales, sin contar como lectura del kanji (${special.length}): ${special.slice(0, 30).join("  ")}${special.length > 30 ? " …" : ""}`);
