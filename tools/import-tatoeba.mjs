/* Frases de Tatoeba (CC BY 2.0 FR) para bank/sentences/<nivel>.json, revisadas
   por la IA antes de publicarse: Tatoeba tiene frases con errores.

     node tools/import-tatoeba.mjs analyse
        descarga las exportaciones de Tatoeba a tools/cache/tatoeba/ (una vez) y
        analiza las frases japonesas con traducción al inglés como lo hace la app:
        de 5 a 12 unidades, todas sus palabras reconocidas y alguna que preguntar.
        Las que alguien valoró mal (-1) en Tatoeba no entran. Deja candidates.json.
     node tools/import-tatoeba.mjs review [--level N5] [--max-calls 50] [--delay 6000] [--batch 10] [--parallel 1] [--dry-run]
        elige hasta 3 frases por palabra (selectSentences) y manda las que faltan por
        revisar a la función review-sentences, de 10 en 10, una llamada detrás de otra. Cada respuesta se guarda
        en reviews.json: se puede cortar y seguir otro día. Si la IA rechaza una,
        la ronda siguiente elige otra para esa palabra.
        Necesita SENTENCE_REVIEW_TOKEN (el secreto de la función) en el entorno o
        en tools/cache/tatoeba/review-token.
     node tools/import-tatoeba.mjs export [--level N4] [--batch 25] [--files 20]
        lo mismo que review, pero sin la función: escribe cada tanda como un prompt en
        tools/cache/tatoeba/manual/prompts/ para pegarlo en otra IA (por ejemplo, una
        local). Su respuesta se guarda en manual/answers/, con cualquier nombre.
     node tools/import-tatoeba.mjs import [--model nombre]
        lee las respuestas de manual/answers/ y las guarda en reviews.json como las
        de la función (con la misma lectura, parseReview). Las tandas leídas se
        borran; lo que la respuesta no decidió vuelve a salir en el próximo export.
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
const { quickFilter, selectSentences, parseReview, answerBatch, attributionOf, REVIEW_PROMPT_VERSION, renderReviewPrompt } = require("./lib/tatoeba.js");

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;

const PER_WORD = 3;        // frases por palabra
// Frases por llamada a la IA: con muchas, la función pasa del tiempo máximo de Supabase (504)
const BATCH = Number(flag("--batch", 10));
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

/* El veredicto de cada candidata, solo si se revisó este mismo texto. Una rechazada
   con un prompt anterior se vuelve a revisar: el 2026-10-27.1 rechazaba por error frases
   con Tom o Mary ("personas reales") y frases normales ("sin contexto"). */
function verdictsOf(candidates, reviews) {
  const verdicts = new Map();
  for (const sentence of candidates) {
    const review = reviews[sentence.id];
    if (!review || review.ja !== sentence.text) continue;
    if (review.keep) verdicts.set(sentence.id, "approved");
    else if (review.version === REVIEW_PROMPT_VERSION) verdicts.set(sentence.id, "rejected");
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

  // En el plan gratuito de Supabase varias llamadas a la vez se rechazan (503, 546): por defecto, una
  const parallel = Math.max(1, Number(flag("--parallel", 1)));
  // Una llamada: devuelve cuántas revisó, o un error que obliga a parar (sin cuota, token malo)
  const send = async (pending, call) => {
    const started = Date.now();
    const response = await fetch(`${new URL(url).origin}/functions/v1/review-sentences`, {
      method: "POST",
      headers: { apikey: anonKey, "x-review-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ batch: `t${Date.now().toString(36)}${call}`, items: pending.map((id) => item(byId.get(id))) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Llamada ${call}: error ${response.status} ${data.error || ""}${data.detail ? ` (${data.detail})` : ""}.`);
      // Sin cuota, token malo o sin claves: no sirve reintentar. Lo demás (Gemini colgado, 504/546) sí
      return { done: 0, stop: [401, 500, 503].includes(response.status) && data.error !== undefined };
    }
    const result = parseReview(data.text, pending);
    for (const [id, verdict] of result) {
      reviews[id] = { ...verdict, ja: byId.get(id).text, version: data.promptVersion || REVIEW_PROMPT_VERSION, model: data.model, at: new Date().toISOString() };
    }
    const kept = [...result.values()].filter((verdict) => verdict.keep).length;
    console.log(`Llamada ${call}: ${result.size} / ${pending.length} revisadas, ${kept} aprobadas (${Math.round((Date.now() - started) / 1000)} s).`);
    return { done: result.size, stop: false };
  };

  // Por rondas de varias llamadas a la vez (cada una tarda más de un minuto); después de
  // cada ronda se vuelve a elegir, por si la IA rechazó alguna y hace falta otra
  let calls = 0, failures = 0;
  while (calls < maxCalls) {
    const { chosen, verdicts } = choose(candidates, reviews, level);
    const pending = [...chosen].filter((id) => !verdicts.has(id));
    if (!pending.length) { console.log("No queda nada por revisar."); break; }
    const round = [];
    for (let i = 0; i < pending.length && round.length < Math.min(parallel, maxCalls - calls); i += BATCH) {
      round.push(send(pending.slice(i, i + BATCH), ++calls));
    }
    const results = await Promise.all(round);
    fs.writeFileSync(REVIEWS, JSON.stringify(reviews));
    if (results.some((result) => result.stop)) {
      console.error("Se para: sin cuota de la IA o sin acceso a la función. Lo revisado ya está guardado; vuelve a intentarlo más tarde.");
      break;
    }
    // Un fallo suelto (Gemini colgado) se reintenta tras una pausa; 5 rondas seguidas sin nada, se para
    if (!results.some((result) => result.done)) {
      if (++failures >= 5) { console.error("5 rondas seguidas sin respuesta: se para. Lo revisado ya está guardado."); break; }
      await new Promise((resolve) => setTimeout(resolve, 15000 * failures));
      continue;
    }
    failures = 0;
    if (calls < maxCalls) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  status();
}

/* =========================================
   REVISIÓN A MANO, CON OTRA IA
   -----------------------------------------
   Para no gastar la cuota de Gemini: export deja los prompts en archivos, el
   administrador los pega en otra IA y guarda cada respuesta en answers/.
   manual/pending.json recuerda qué frases lleva cada tanda (la respuesta solo
   trae ids, y parseReview necesita saber cuáles se pidieron).
   ========================================= */

const MANUAL = cachePath("tatoeba", "manual", "pending.json");
const PROMPTS = path.join(path.dirname(MANUAL), "prompts");
const ANSWERS = path.join(path.dirname(MANUAL), "answers");
const loadManual = () => fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, "utf8")) : { next: 1, batches: {} };

function exportPrompts() {
  const level = flag("--level", "") && String(flag("--level")).toUpperCase();
  const size = Number(flag("--batch", 25)), files = Number(flag("--files", 20));
  const candidates = loadCandidates(), reviews = loadReviews(), manual = loadManual();
  const byId = new Map(candidates.map((sentence) => [sentence.id, sentence]));
  // Las que ya van en una tanda sin contestar no se vuelven a mandar
  const waiting = new Set(Object.values(manual.batches).flatMap((batch) => batch.ids));
  fs.mkdirSync(PROMPTS, { recursive: true });
  fs.mkdirSync(ANSWERS, { recursive: true });
  let written = 0;
  for (const current of level ? [level] : BANK.LEVELS) {
    const { chosen, verdicts } = choose(candidates, reviews, current);
    const pending = [...chosen].filter((id) => !verdicts.has(id) && !waiting.has(id));
    for (let i = 0; i < pending.length && written < files; i += size) {
      const ids = pending.slice(i, i + size);
      const batch = `${current.toLowerCase()}-${String(manual.next++).padStart(3, "0")}`;
      const items = ids.map((id) => ({ id, ja: byId.get(id).text, en: byId.get(id).en, es: byId.get(id).es }));
      fs.writeFileSync(path.join(PROMPTS, `${batch}.txt`), renderReviewPrompt({ batch, items }) + "\n");
      manual.batches[batch] = { ids, at: new Date().toISOString() };
      written++;
    }
  }
  fs.writeFileSync(MANUAL, JSON.stringify(manual, null, 1));
  const total = Object.keys(manual.batches).length;
  console.log(`${written} prompts nuevos en ${path.relative(process.cwd(), PROMPTS)} (${total} esperando respuesta).`);
  if (total) console.log(`Pega cada uno en la IA y guarda su respuesta en ${path.relative(process.cwd(), ANSWERS)}/ ` +
    "(por ejemplo n4-001.txt); luego: node tools/import-tatoeba.mjs import");
}

function importAnswers() {
  const model = flag("--model", "manual");
  const candidates = loadCandidates(), reviews = loadReviews(), manual = loadManual();
  const byId = new Map(candidates.map((sentence) => [sentence.id, sentence]));
  const files = fs.existsSync(ANSWERS) ? fs.readdirSync(ANSWERS).filter((name) => !name.startsWith(".")) : [];
  if (!files.length) { console.log(`No hay respuestas en ${path.relative(process.cwd(), ANSWERS)}/.`); return; }
  let reviewed = 0, kept = 0;
  for (const name of files) {
    const raw = fs.readFileSync(path.join(ANSWERS, name), "utf8");
    const batch = [answerBatch(raw), path.parse(name).name].find((id) => id && manual.batches[id]);
    if (!batch) { console.error(`${name}: no es la respuesta de ninguna tanda pendiente; se deja.`); continue; }
    const { ids } = manual.batches[batch];
    const result = parseReview(raw, ids);
    if (!result.size) { console.error(`${name}: no se entiende la respuesta (¿JSON incompleto?); se deja.`); continue; }
    for (const [id, verdict] of result) {
      reviews[id] = { ...verdict, ja: byId.get(id).text, version: REVIEW_PROMPT_VERSION, model, at: new Date().toISOString() };
      if (verdict.keep) kept++;
    }
    reviewed += result.size;
    console.log(`${batch}: ${result.size} / ${ids.length} revisadas, ${[...result.values()].filter((v) => v.keep).length} aprobadas.`);
    delete manual.batches[batch];
    fs.rmSync(path.join(ANSWERS, name));
    fs.rmSync(path.join(PROMPTS, `${batch}.txt`), { force: true });
  }
  fs.writeFileSync(REVIEWS, JSON.stringify(reviews));
  fs.writeFileSync(MANUAL, JSON.stringify(manual, null, 1));
  console.log(`En total: ${reviewed} revisadas, ${kept} aprobadas.`);
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
else if (command === "export") exportPrompts();
else if (command === "import") importAnswers();
else if (command === "ingest") ingest();
else if (command === "status") status();
else {
  console.log("Uso: node tools/import-tatoeba.mjs analyse|review|export|import|ingest|status [--level N5] [--max-calls 50] [--delay 6000] [--dry-run]");
  process.exit(command ? 1 : 0);
}
