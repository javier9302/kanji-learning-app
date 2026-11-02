/* La limpieza de las palabras guardadas (story-core.js, sección 6) sobre una
   copia de los datos, sin tocar nada: para ver la lista de cambios antes de
   aplicarla en la app, o para revisar una copia de seguridad.
     node tools/word-cleanup.mjs palabras.json [--entries fichas.json] [--json]
   palabras.json: [{ id, lemma, reading, status, repetitions, … }] (la copia que
   descarga la app antes de limpiar, su campo userWords, o filas de user_words
   con sus nombres de Supabase). --entries: { id: { meanings, meaningsEs } } del
   diccionario propio, para saber qué palabras no tienen significado; sin él,
   una palabra fuera del banco y del diccionario general se queda. */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBank } = require("./lib/bank.js");
const { loadTokenizer } = require("./lib/tokenizer.js");
const { ROOT } = require("./lib/bank.js");
const { savedWordTools, planWordCleanup } = require("../story-core.js");

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const file = args.find((arg, i) => !arg.startsWith("--") && !["--entries"].includes(args[i - 1]));
if (!file) {
  console.error("Uso: node tools/word-cleanup.mjs palabras.json [--entries fichas.json] [--json]");
  process.exit(1);
}

// Filas de Supabase (repetitions, can_read_kanji…) o registros de la app: se pasan a los de la app
const fromRow = (row) => ({
  ...row, studied: !!row.studied, repetitions: row.repetitions || 0,
  canReadKanji: row.canReadKanji ?? row.can_read_kanji, knowsMeaning: row.knowsMeaning ?? row.knows_meaning,
  canWrite: row.canWrite ?? row.can_write, evalCorrect: row.evalCorrect ?? row.eval_correct ?? 0,
  evalWrong: row.evalWrong ?? row.eval_wrong ?? 0
});
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const records = (Array.isArray(raw) ? raw : raw.userWords).map(fromRow);
const entriesFile = option("--entries");
const entries = entriesFile ? new Map(Object.entries(JSON.parse(fs.readFileSync(entriesFile, "utf8")))) : null;

const jmdict = new Map();
const dictFile = fs.readdirSync(`${ROOT}/vendor/jmdict`).find((name) => name.endsWith(".json"));
for (const [lemma, reading, meanings, meanings_es, uk] of JSON.parse(fs.readFileSync(`${ROOT}/vendor/jmdict/${dictFile}`, "utf8"))) {
  if (!jmdict.has(lemma)) jmdict.set(lemma, { reading, meanings, meanings_es, uk: !!uk });
}

const tokenizer = await loadTokenizer();
const tools = savedWordTools({ bank: loadBank(), jmdict, entries, records: new Map(records.map((rec) => [rec.id, rec])), tokenizer });
const plan = planWordCleanup(records, tools);

if (args.includes("--json")) {
  console.log(JSON.stringify({ drops: plan.drops.map(({ id, reason }) => ({ id, reason })),
    moves: plan.moves.map(({ from, to, why }) => ({ from, to, why })), save: plan.save, remove: plan.remove }, null, 1));
} else {
  const brief = (rec) => `${rec.status}${rec.repetitions ? `, ${rec.repetitions} rep.` : ""}`;
  console.log(`${records.length} palabras: ${plan.drops.length} se borran, ${plan.moves.length} cambian de forma, ` +
    `${plan.save.length} quedan escritas de nuevo.\n`);
  console.log("SE BORRAN");
  for (const { id, reason, rec } of plan.drops) console.log(`  ${id}  (${brief(rec)}): ${reason}`);
  console.log("\nCAMBIAN (y se unen si ya existía)");
  const byTarget = new Map(plan.save.map((rec) => [rec.id, rec]));
  for (const { from, to, why, rec } of plan.moves) {
    const exists = records.some((other) => other.id === to);
    console.log(`  ${from} (${brief(rec)}) -> ${to}${exists ? " [ya existía: se une]" : ""}: ${why}`);
  }
  console.log("\nRESULTADO DE LAS UNIONES");
  for (const rec of byTarget.values()) console.log(`  ${rec.id}: ${brief(rec)}, vista ${rec.seen}, consultada ${rec.lookups}`);
}
