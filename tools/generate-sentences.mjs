/* Frases comunes de la app (bank/sentences/<nivel>.json) escritas por una IA,
   por tandas, sin ninguna API: se copia cada prompt en un chat de IA y se pega
   su respuesta en un archivo. Todo se comprueba con la misma regla que usa la
   app (validateSentence, sentences-core.js).

     node tools/generate-sentences.mjs prompts --level N5 [--batch-size 35] [--limit 3]
        escribe tools/cache/sentences/prompts/n5-001.txt, n5-002.txt…: una tanda de
        palabras que aún no tienen 2 frases válidas
     (copias el prompt en la IA y pegas su respuesta, tal cual, en
        tools/cache/sentences/responses/n5-001.json — el mismo nombre)
     node tools/generate-sentences.mjs ingest --level N5
        comprueba todas las respuestas del nivel, escribe bank/sentences/n5.json
        e informa de cuántas se rechazaron y por qué
     node tools/generate-sentences.mjs status --level N5
        cuántas palabras tienen ya sus 2 frases y qué tandas faltan por responder

   Es idempotente: ingest rehace las frases de IA del nivel a partir de todas
   las respuestas guardadas, y prompts solo pide las palabras que faltan y que
   no estén ya en una tanda sin responder. tools/cache/ no se sube al repositorio. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank } = require("./lib/bank.js");
const { cachePath } = require("./lib/cache.js");
const { sentenceFile } = require("./lib/sentences.js");
const { sentenceFrom, wordOf } = require("./lib/analyse.js");
const { validateSentence, sentenceFingerprint } = require("../sentences-core.js");
const { renderSentencePrompt, parseResponse, promptTargets } = require("./lib/sentence-batches.js");

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const level = String(flag("--level", "N5")).toUpperCase();
const batchSize = Number(flag("--batch-size", 35));
const limit = Number(flag("--limit", Infinity));

const PER_TARGET = 2;           // frases válidas que se quieren por palabra
const UNITS = [5, 12];          // unidades sin contar la puntuación
const BANK = loadBank();
if (!BANK.LEVELS.includes(level)) { console.error(`Nivel desconocido: ${level}`); process.exit(1); }
const lower = level.toLowerCase();
const promptDir = path.dirname(cachePath("sentences", "prompts", "x"));
const responseDir = path.dirname(cachePath("sentences", "responses", "x"));

/* Palabras que necesitan frases: las del nivel con kanji (las que casi siempre
   van en kana no se preguntan) */
const targetsOf = (lv) => [...BANK.words.values()].filter((word) => word.level === lv && !word.kana && word.kanji.length);
const meaningOf = (word) => (word.en || []).slice(0, 2).join("; ");

/* =========================================
   EL PROMPT
   ========================================= */

/* Vocabulario permitido: en N5 y N4 se da la lista entera (cabe); en niveles
   más altos solo se nombra el nivel */
function vocabulary() {
  const levels = BANK.LEVELS.slice(0, BANK.LEVELS.indexOf(level) + 1);
  if (BANK.LEVELS.indexOf(level) > 1) return { levels, words: null };
  const words = [...BANK.words.values()].filter((word) => levels.includes(word.level)).map((word) => word.kana ? word.r : word.w);
  return { levels, words: [...new Set(words)] };
}
const renderPrompt = (batch, words) => renderSentencePrompt({
  batch, level, perTarget: PER_TARGET, units: UNITS, vocabulary: vocabulary(),
  words: words.map((word) => ({ id: word.id, w: word.w, r: word.r, meaning: meaningOf(word) }))
});
const readResponse = (file) => {
  try {
    return parseResponse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.basename(file)}: ${error.message}`);
  }
};

/* =========================================
   LEER LAS RESPUESTAS
   ========================================= */

const batchName = (n) => `${lower}-${String(n).padStart(3, "0")}`;
const promptFiles = () => fs.readdirSync(promptDir).filter((f) => f.startsWith(`${lower}-`) && f.endsWith(".txt")).sort();
const responseFile = (batch) => path.join(responseDir, `${batch}.json`);
/* Palabras de cada tanda: se leen del propio prompt, para no depender de nada más */
const batchWords = (file) => promptTargets(fs.readFileSync(path.join(promptDir, file), "utf8"));

/* Frases ya publicadas del nivel (las que no son de IA se conservan siempre) */
const published = () => fs.existsSync(sentenceFile(level)) ? JSON.parse(fs.readFileSync(sentenceFile(level), "utf8")) : [];

/* Cuántas frases válidas tiene cada palabra */
function coverage(sentences) {
  const count = new Map();
  for (const sentence of sentences) for (const target of sentence.targets) count.set(target, (count.get(target) || 0) + 1);
  return count;
}

/* =========================================
   COMANDOS
   ========================================= */

async function ingest({ quiet = false, write = true } = {}) {
  const others = published().filter((sentence) => sentence.source !== "ai");
  const seen = new Set(others.map(sentenceFingerprint));
  const accepted = [], reasons = new Map(), perBatch = [];
  const count = (reason) => reasons.set(reason, (reasons.get(reason) || 0) + 1);

  for (const file of promptFiles()) {
    const batch = file.replace(/\.txt$/, ""), wanted = new Set(batchWords(file));
    if (!fs.existsSync(responseFile(batch))) continue;
    let list;
    try {
      list = readResponse(responseFile(batch));
    } catch (error) {
      console.error(`✗ ${error.message}`);
      perBatch.push([batch, 0, 0]);
      continue;
    }
    let ok = 0;
    for (const item of list) {
      const ja = typeof item?.ja === "string" ? item.ja.trim() : "";
      if (!ja || ja.split("|").some((unit) => !unit.trim())) { count("empty_units"); continue; }
      if (!item.en && !item.es) { count("no_translation"); continue; }
      const declared = (Array.isArray(item.targets) ? item.targets : []).filter((id) => wanted.has(id));
      if (!declared.length) { count("no_target"); continue; }
      const sentence = await sentenceFrom({
        id: `ai-${lower}-${crypto.createHash("sha1").update(ja).digest("hex").slice(0, 10)}`,
        ja, en: String(item.en || "").trim(), es: String(item.es || "").trim(),
        source: "ai", sourceId: batch, attribution: "", fallbackLevel: level
      });
      // Cada palabra declarada se comprueba por separado: vale la frase si sirve al menos para una
      const results = declared.map((target) => validateSentence(sentence, {
        text: ja.split("|").join(""), minUnits: UNITS[0], maxUnits: UNITS[1], targets: [target], maxLevel: level, wordOf
      }));
      const good = declared.filter((_, i) => results[i].ok);
      if (!good.length) { results[0].reasons.forEach(count); continue; }
      const print = sentenceFingerprint(sentence);
      if (seen.has(print)) { count("duplicate"); continue; }
      seen.add(print);
      accepted.push(sentence);
      ok++;
    }
    perBatch.push([batch, list.length, ok]);
  }

  const all = [...others, ...accepted];
  if (write && (accepted.length || fs.existsSync(sentenceFile(level)))) {
    fs.mkdirSync(path.dirname(sentenceFile(level)), { recursive: true });
    fs.writeFileSync(sentenceFile(level), JSON.stringify(all) + "\n");
  }

  if (quiet) return all;
  const total = perBatch.reduce((sum, [, n]) => sum + n, 0);
  console.log(`Tandas respondidas: ${perBatch.length}. Frases recibidas: ${total}; aceptadas: ${accepted.length} (${total ? Math.round(accepted.length / total * 100) : 0} %).`);
  for (const [batch, n, ok] of perBatch) console.log(`  ${batch}: ${ok} / ${n}`);
  if (reasons.size) {
    console.log("Rechazadas por motivo:");
    const LABEL = {
      units_mismatch: "las unidades no reproducen la frase", length: `menos de ${UNITS[0]} o más de ${UNITS[1]} unidades`,
      latin: "letras latinas", brackets: "paréntesis o comillas sin cerrar", unresolved: "palabras que no están en el banco",
      level: `vocabulario por encima de ${level}`, target_missing: "no aparece la palabra pedida",
      reading_mismatch: "la palabra se lee de otra forma", no_target: "sin palabra de la tanda", duplicate: "repetida o casi igual",
      empty_units: "unidades vacías", no_translation: "sin traducción", tokenize: "no se pudo analizar"
    };
    for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${LABEL[reason] || reason}`);
  }
  const map = coverage(all), targets = targetsOf(level);
  const full = targets.filter((word) => (map.get(word.id) || 0) >= PER_TARGET).length;
  console.log(`Palabras de ${level} con ${PER_TARGET} frases o más: ${full} de ${targets.length} (${Math.round(full / targets.length * 100)} %).`);
  console.log(`Escrito ${path.relative(process.cwd(), sentenceFile(level))} (${all.length} frases).`);
  return all;
}

async function prompts() {
  const map = coverage(await ingest({ quiet: true, write: false })); // solo para saber qué falta: no escribe nada
  // Palabras ya pedidas en una tanda que aún no tiene respuesta: no se vuelven a pedir
  const waiting = new Set();
  for (const file of promptFiles()) {
    if (!fs.existsSync(responseFile(file.replace(/\.txt$/, "")))) batchWords(file).forEach((id) => waiting.add(id));
  }
  const missing = targetsOf(level)
    .filter((word) => (map.get(word.id) || 0) < PER_TARGET && !waiting.has(word.id))
    .sort((a, b) => (BANK.frequency[a.id] || 1e9) - (BANK.frequency[b.id] || 1e9)); // primero las más frecuentes
  let next = promptFiles().length + 1, written = [];
  for (let i = 0; i < missing.length && written.length < limit; i += batchSize) {
    const batch = batchName(next++), words = missing.slice(i, i + batchSize);
    fs.writeFileSync(path.join(promptDir, `${batch}.txt`), renderPrompt(batch, words));
    written.push(`${batch} (${words.length} palabras)`);
  }
  console.log(written.length
    ? `Prompts nuevos en ${path.relative(process.cwd(), promptDir)}/:\n  ${written.join("\n  ")}`
    : "No hace falta ninguna tanda nueva.");
  if (waiting.size) console.log(`${waiting.size} palabras esperan la respuesta de tandas ya escritas.`);
  console.log(`Pega cada respuesta en ${path.relative(process.cwd(), responseDir)}/<tanda>.json y después ejecuta: node tools/generate-sentences.mjs ingest --level ${level}`);
}

function status() {
  const map = coverage(published()), targets = targetsOf(level);
  const full = targets.filter((word) => (map.get(word.id) || 0) >= PER_TARGET).length;
  console.log(`${level}: ${full} de ${targets.length} palabras con ${PER_TARGET} frases o más.`);
  for (const file of promptFiles()) {
    const batch = file.replace(/\.txt$/, "");
    console.log(`  ${batch}: ${fs.existsSync(responseFile(batch)) ? "respondida" : "SIN RESPUESTA"} (${batchWords(file).length} palabras)`);
  }
}

if (command === "prompts") await prompts();
else if (command === "ingest") await ingest();
else if (command === "status") status();
else {
  console.log("Uso: node tools/generate-sentences.mjs prompts|ingest|status --level N5 [--batch-size 35] [--limit 3]");
  process.exit(command ? 1 : 0);
}
