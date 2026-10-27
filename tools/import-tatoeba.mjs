/* Frases de Tatoeba (CC BY 2.0 FR) para bank/sentences/<nivel>.json, revisadas
   por la IA antes de publicarse: Tatoeba tiene frases con errores.

     node tools/import-tatoeba.mjs analyse
        descarga las exportaciones de Tatoeba a tools/cache/tatoeba/ (una vez) y
        analiza las frases japonesas con traducción al inglés como lo hace la app:
        de 5 a 12 unidades, todas sus palabras reconocidas y alguna que preguntar.
        Las que alguien valoró mal (-1) en Tatoeba no entran. Deja candidates.json.
     node tools/import-tatoeba.mjs review [--level N5] [--max-calls 50] [--delay 6000] [--dry-run]
        elige hasta 3 frases por palabra (selectSentences) y manda las que faltan por
        revisar a la función review-sentences, de 40 en 40. Cada respuesta se guarda
        en reviews.json: se puede cortar y seguir otro día. Si la IA rechaza una,
        la ronda siguiente elige otra para esa palabra.
        Necesita SENTENCE_REVIEW_TOKEN (el secreto de la función) en el entorno o
        en tools/cache/tatoeba/review-token.
     node tools/import-tatoeba.mjs ingest
        escribe en bank/sentences/<nivel>.json las frases elegidas y aprobadas, con
        las traducciones de la IA (las frases de IA del archivo se conservan).
     node tools/import-tatoeba.mjs status
        cuántas palabras tienen ya sus frases y cuántas faltan por revisar.

   La IA nunca cambia el japonés. tools/cache/ no se sube al repositorio. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROOT, loadBank } = require("./lib/bank.js");
const { cachePath, download } = require("./lib/cache.js");
const { sentenceFile } = require("./lib/sentences.js");
const { sentenceFrom, wordOf } = require("./lib/analyse.js");
const { loadTokenizer } = require("./lib/tokenizer.js");
const { segmentSentence } = require("../ja-core.js");
const { validateSentence } = require("../sentences-core.js");
const { quickFilter, selectSentences, parseReview, attributionOf, REVIEW_PROMPT_VERSION, renderReviewPrompt } = require("./lib/tatoeba.js");

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;

const PER_WORD = 3;        // frases por palabra
const BATCH = 40;          // frases por llamada a la IA
const UNITS = [5, 12];     // unidades sin contar la puntuación (como las de la IA)
const EXPORTS = "https://downloads.tatoeba.org/exports";
const FILES = {
  jpn: "per_language/jpn/jpn_sentences_detailed.tsv.bz2",
  jpnEng: "per_language/jpn/jpn-eng_links.tsv.bz2",
  jpnSpa: "per_language/jpn/jpn-spa_links.tsv.bz2",
  eng: "per_language/eng/eng_sentences.tsv.bz2",
  spa: "per_language/spa/spa_sentences.tsv.bz2",
  reviews: "users_sentences.csv"
};
const CANDIDATES = cachePath("tatoeba", "candidates.json");
const REVIEWS = cachePath("tatoeba", "reviews.json");
const BANK = loadBank();

/* Cada línea de un archivo de Tatoeba (los .bz2 se descomprimen con bunzip2) */
async function eachLine(file, fn) {
  const child = file.endsWith(".bz2") ? spawn("bunzip2", ["-c", file]) : null;
  const input = child ? child.stdout : fs.createReadStream(file);
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) fn(line.split("\t"));
}

const fetchAll = async () => Object.fromEntries(await Promise.all(Object.entries(FILES)
  .map(async ([key, file]) => [key, await download(`${EXPORTS}/${file}`, "tatoeba", path.basename(file))])));

/* =========================================
   ANALIZAR
   ========================================= */

async function analyse() {
  const files = await fetchAll();
  const japanese = new Map(); // número -> { text, user }
  await eachLine(files.jpn, ([id, , text, user]) => { if (quickFilter(text)) japanese.set(id, { text, user }); });
  const links = async (file) => {
    const map = new Map();
    await eachLine(file, ([from, to]) => { if (japanese.has(from) && !map.has(from)) map.set(from, to); }); // la primera traducción
    return map;
  };
  const toEng = await links(files.jpnEng), toSpa = await links(files.jpnSpa);
  const plus = new Map(), minus = new Set();
  await eachLine(files.reviews, ([, id, review]) => {
    if (!japanese.has(id)) return;
    if (review === "1") plus.set(id, (plus.get(id) || 0) + 1);
    if (review === "-1") minus.add(id);
  });
  const ids = [...japanese.keys()].filter((id) => toEng.has(id) && !minus.has(id));
  const texts = async (file, wanted) => {
    const map = new Map();
    await eachLine(file, ([id, , text]) => { if (wanted.has(id)) map.set(id, text); });
    return map;
  };
  const eng = await texts(files.eng, new Set(ids.map((id) => toEng.get(id))));
  const spa = await texts(files.spa, new Set(ids.map((id) => toSpa.get(id)).filter(Boolean)));
  console.log(`Japonesas: ${japanese.size} pasan el filtro rápido; ${ids.length} con inglés y sin valoraciones negativas.`);

  const tokenizer = await loadTokenizer();
  const candidates = [], reasons = new Map();
  let done = 0;
  for (const id of ids) {
    if (++done % 10000 === 0) console.log(`  ${done} / ${ids.length} analizadas…`);
    const { text, user } = japanese.get(id);
    const en = eng.get(toEng.get(id));
    if (!en) continue;
    const sentence = await sentenceFrom({
      id: `tatoeba-${id}`, ja: segmentSentence(tokenizer, text), en, es: spa.get(toSpa.get(id)) || "",
      source: "tatoeba", sourceId: id, attribution: attributionOf(id, user), fallbackLevel: "N1"
    });
    const check = validateSentence(sentence, { text, minUnits: UNITS[0], maxUnits: UNITS[1], maxLevel: sentence.level, wordOf });
    if (!check.ok) { check.reasons.forEach((reason) => reasons.set(reason, (reasons.get(reason) || 0) + 1)); continue; }
    candidates.push({ ...sentence, text, plus: plus.get(id) || 0, units: sentence.tokens.filter((t) => t.pos !== "punctuation").length });
  }
  fs.writeFileSync(CANDIDATES, JSON.stringify(candidates));
  console.log(`Candidatas: ${candidates.length}. Descartadas por motivo: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ")}`);
  const byLevel = {};
  for (const sentence of candidates) byLevel[sentence.level] = (byLevel[sentence.level] || 0) + 1;
  console.log("Por nivel:", byLevel);
}

/* =========================================
   ELEGIR Y REVISAR
   ========================================= */

const loadCandidates = () => {
  if (!fs.existsSync(CANDIDATES)) { console.error("Primero: node tools/import-tatoeba.mjs analyse"); process.exit(1); }
  return JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));
};
const loadReviews = () => fs.existsSync(REVIEWS) ? JSON.parse(fs.readFileSync(REVIEWS, "utf8")) : {};

/* Las palabras que se preguntan (con kanji y que no van casi siempre en kana) */
function wordTable() {
  const words = new Map();
  for (const word of BANK.words.values()) {
    if (!word.kana && word.kanji.length) words.set(word.id, { level: word.level, rank: BANK.frequency[word.id] ?? 1e9 });
  }
  return words;
}

/* El veredicto de cada candidata, solo si se revisó este mismo texto */
function verdictsOf(candidates, reviews) {
  const verdicts = new Map();
  for (const sentence of candidates) {
    const review = reviews[sentence.id];
    if (review && review.ja === sentence.text) verdicts.set(sentence.id, review.keep ? "approved" : "rejected");
  }
  return verdicts;
}

function choose(candidates, reviews, level) {
  const list = level ? candidates.filter((sentence) => sentence.level === level) : candidates;
  const verdicts = verdictsOf(list, reviews);
  return { chosen: selectSentences({ candidates: list, words: wordTable(), verdicts, perWord: PER_WORD }), verdicts };
}

function reviewToken() {
  const file = cachePath("tatoeba", "review-token");
  return process.env.SENTENCE_REVIEW_TOKEN || (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "");
}

async function review() {
  const level = flag("--level", "") && String(flag("--level")).toUpperCase();
  const maxCalls = Number(flag("--max-calls", 50)), delay = Number(flag("--delay", 6000));
  const candidates = loadCandidates(), reviews = loadReviews();
  const byId = new Map(candidates.map((sentence) => [sentence.id, sentence]));
  const item = (sentence) => ({ id: sentence.id, ja: sentence.text, en: sentence.en, es: sentence.es });

  if (args.includes("--dry-run")) {
    const { chosen, verdicts } = choose(candidates, reviews, level);
    const pending = [...chosen].filter((id) => !verdicts.has(id));
    console.log(`Elegidas: ${chosen.size}; por revisar: ${pending.length} (${Math.ceil(pending.length / BATCH)} llamadas).`);
    if (pending.length) console.log(renderReviewPrompt({ batch: "prueba", items: pending.slice(0, 3).map((id) => item(byId.get(id))) }));
    return;
  }
  const token = reviewToken();
  if (!token) { console.error("Falta SENTENCE_REVIEW_TOKEN (el secreto de la función review-sentences)."); process.exit(1); }
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, "config.js"), "utf8"), context);
  const { url, anonKey } = vm.runInContext("SUPABASE_CONFIG", context);

  for (let call = 1; call <= maxCalls; call++) {
    const { chosen, verdicts } = choose(candidates, reviews, level);
    const pending = [...chosen].filter((id) => !verdicts.has(id)).slice(0, BATCH);
    if (!pending.length) { console.log("No queda nada por revisar."); break; }
    const batch = `t${Date.now().toString(36)}`;
    const started = Date.now();
    const response = await fetch(`${new URL(url).origin}/functions/v1/review-sentences`, {
      method: "POST",
      headers: { apikey: anonKey, "x-review-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ batch, items: pending.map((id) => item(byId.get(id))) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Llamada ${call}: error ${response.status} ${data.error || ""}${data.detail ? ` (${data.detail})` : ""}.`);
      if (response.status === 503) console.error("La IA no tiene cuota ahora: vuelve a intentarlo más tarde (lo revisado ya está guardado).");
      break;
    }
    const result = parseReview(data.text, pending);
    for (const [id, verdict] of result) {
      reviews[id] = { ...verdict, ja: byId.get(id).text, version: data.promptVersion || REVIEW_PROMPT_VERSION, model: data.model, at: new Date().toISOString() };
    }
    fs.writeFileSync(REVIEWS, JSON.stringify(reviews));
    const kept = [...result.values()].filter((verdict) => verdict.keep).length;
    console.log(`Llamada ${call}: ${result.size} / ${pending.length} revisadas, ${kept} aprobadas (${Math.round((Date.now() - started) / 1000)} s).`);
    if (!result.size) { console.error("La respuesta no se pudo leer; se para para no gastar cuota."); break; }
    if (call < maxCalls) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  status();
}

/* =========================================
   PUBLICAR
   ========================================= */

function ingest() {
  const candidates = loadCandidates(), reviews = loadReviews();
  for (const level of BANK.LEVELS) {
    const { chosen, verdicts } = choose(candidates, reviews, level);
    const fresh = candidates.filter((sentence) => chosen.has(sentence.id) && verdicts.get(sentence.id) === "approved")
      .map(({ text, plus, units, ...sentence }) => ({ ...sentence, en: reviews[sentence.id].en, es: reviews[sentence.id].es }));
    const file = sentenceFile(level);
    const others = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).filter((sentence) => sentence.source !== "tatoeba") : [];
    if (!fresh.length && !fs.existsSync(file)) continue;
    fs.writeFileSync(file, JSON.stringify([...fresh, ...others]) + "\n");
    console.log(`${path.relative(process.cwd(), file)}: ${fresh.length} de Tatoeba y ${others.length} de IA.`);
  }
}

function status() {
  const candidates = loadCandidates(), reviews = loadReviews(), words = wordTable();
  for (const level of BANK.LEVELS) {
    const { chosen, verdicts } = choose(candidates, reviews, level);
    const approved = new Map();
    for (const sentence of candidates) {
      if (!chosen.has(sentence.id) || verdicts.get(sentence.id) !== "approved") continue;
      for (const target of sentence.targets) if (words.get(target)?.level === level) approved.set(target, (approved.get(target) || 0) + 1);
    }
    const total = [...words.values()].filter((word) => word.level === level).length;
    const full = [...approved.values()].filter((n) => n >= PER_WORD).length;
    const pending = [...chosen].filter((id) => !verdicts.has(id)).length;
    const rejected = candidates.filter((sentence) => sentence.level === level && verdicts.get(sentence.id) === "rejected").length;
    console.log(`${level}: ${approved.size} de ${total} palabras con alguna frase aprobada, ${full} con ${PER_WORD}; ` +
      `${chosen.size} elegidas, ${pending} por revisar (${Math.ceil(pending / BATCH)} llamadas), ${rejected} rechazadas.`);
  }
  const reasons = {};
  for (const review of Object.values(reviews)) if (!review.keep) reasons[review.reason] = (reasons[review.reason] || 0) + 1;
  if (Object.keys(reasons).length) console.log("Rechazadas por motivo:", reasons);
}

if (command === "analyse") await analyse();
else if (command === "review") await review();
else if (command === "ingest") ingest();
else if (command === "status") status();
else {
  console.log("Uso: node tools/import-tatoeba.mjs analyse|review|ingest|status [--level N5] [--max-calls 50] [--delay 6000] [--dry-run]");
  process.exit(command ? 1 : 0);
}
