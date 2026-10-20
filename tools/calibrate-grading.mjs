/* Calibración de la corrección de traducciones: 30 frases × 4 tipos de respuesta
   (perfecta, paráfrasis válida, en parte mal, mal o sin relación) × 2 idiomas,
   corregidas por la función grade-translation YA DESPLEGADA, con una cuenta real.
   Compara el veredicto esperado con el que da la IA y mide tokens y tiempos.

     node tools/calibrate-grading.mjs --dry-run            no llama a nada: enseña el plan
     CALIBRATION_EMAIL=… CALIBRATION_PASSWORD=… node tools/calibrate-grading.mjs [--limit 20] [--lang es]

   - La cuenta y la contraseña solo se leen de las variables de entorno; no se guardan.
   - Son 240 llamadas: sube antes DAILY_GRADES (por ejemplo a 300) en los secretos de
     Supabase y vuelve a dejarlo después. Cada respuesta se guarda en
     tools/cache/calibration/, así que se puede cortar y seguir otro día.
   - Va despacio a propósito (--delay ms, 5000 por defecto) por el límite por minuto
     del plan gratuito de Gemini. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROOT } = require("./lib/bank.js");
const { cachePath } = require("./lib/cache.js");
const { tokensFor } = require("./lib/analyse.js");

const args = process.argv.slice(2);
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const dryRun = args.includes("--dry-run");
const limit = Number(flag("--limit", Infinity)), delay = Number(flag("--delay", 5000)), onlyLang = flag("--lang", "");

const KINDS = ["perfect", "paraphrase", "partial", "wrong"];
const EXPECTED = { perfect: "correct", paraphrase: "correct", partial: "partial", wrong: "incorrect" };
const VERDICTS = ["correct", "mostly", "partial", "incorrect"];
const { UNCOUNTED_POS: CONTENT_OUT } = require("../ja-core.js");

const sentences = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/calibration/sentences.json"), "utf8"));
const cases = [];
for (const sentence of sentences) {
  const tokens = await tokensFor(sentence.ja), seen = new Set();
  const units = tokens.map((token) => {
    const content = !CONTENT_OUT.has(token.pos) && !!token.key && !seen.has(token.key);
    if (content) seen.add(token.key);
    return { surface: token.surface, lemma: token.lemma, reading: token.reading || "", content };
  });
  for (const lang of ["es", "en"]) {
    if (onlyLang && lang !== onlyLang) continue;
    sentence.answers[lang].forEach((answer, index) => cases.push({
      kind: KINDS[index], lang, answer,
      body: { sentenceId: sentence.id, ja: sentence.ja.split("|").join(""), units, reference: { en: sentence.en, es: sentence.es }, answer, lang }
    }));
  }
}
const cacheFile = (item) => cachePath("calibration", `${crypto.createHash("sha1").update(JSON.stringify(item.body)).digest("hex").slice(0, 16)}.json`);
const pending = cases.filter((item) => !fs.existsSync(cacheFile(item)));

console.log(`${sentences.length} frases, ${cases.length} respuestas; ${cases.length - pending.length} ya corregidas, ${pending.length} por corregir.`);
if (dryRun) {
  const noContent = cases.filter((item) => !item.body.units.some((unit) => unit.content)).length;
  console.log(`Modo de prueba: no se llama a nada. Respuestas sin ninguna palabra que valorar: ${noContent}.`);
  console.log("Ejemplo de petición:", JSON.stringify(cases[1].body, null, 1).slice(0, 700), "…");
  process.exit(0);
}

/* ---------- Sesión y llamadas ---------- */
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, "config.js"), "utf8"), context);
const { url, anonKey } = vm.runInContext("SUPABASE_CONFIG", context);
const base = new URL(url).origin;
const email = process.env.CALIBRATION_EMAIL, password = process.env.CALIBRATION_PASSWORD;
// Sin cuenta no se corrige nada nuevo, pero se enseña el informe de lo ya guardado
const canCall = !!(email && password);
if (pending.length && !canCall) console.error("Faltan CALIBRATION_EMAIL y CALIBRATION_PASSWORD (una cuenta de la app): solo se enseña lo ya corregido.");

if (pending.length && canCall) {
  const login = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
  });
  const session = await login.json();
  if (!login.ok || !session.access_token) { console.error(`No se pudo iniciar sesión (${login.status}).`); process.exit(1); }

  let done = 0;
  for (const item of pending.slice(0, limit)) {
    const started = Date.now();
    const response = await fetch(`${base}/functions/v1/grade-translation`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.body, requestId: crypto.randomUUID() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Parado en la respuesta ${done + 1}: ${response.status} ${data.error || ""}${data.limit ? ` (límite ${data.limit})` : ""}. Lo hecho queda guardado.`);
      break;
    }
    fs.writeFileSync(cacheFile(item), JSON.stringify({ ...data, roundTripMs: Date.now() - started }));
    done++;
    process.stderr.write(`\r${done} / ${Math.min(limit, pending.length)}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  process.stderr.write("\n");
}

/* ---------- Informe ---------- */
const graded = cases.filter((item) => fs.existsSync(cacheFile(item)))
  .map((item) => ({ ...item, data: JSON.parse(fs.readFileSync(cacheFile(item), "utf8")) }));
if (!graded.length) process.exit(0);

for (const lang of ["es", "en", "todos"]) {
  const list = graded.filter((item) => lang === "todos" || item.lang === lang);
  if (!list.length) continue;
  console.log(`\nEsperado × veredicto de la IA (${lang}, ${list.length} respuestas)`);
  console.log(`${"".padEnd(12)}${VERDICTS.map((v) => v.padStart(10)).join("")}   acierto`);
  for (const kind of KINDS) {
    const row = list.filter((item) => item.kind === kind);
    const counts = VERDICTS.map((verdict) => row.filter((item) => item.data.result.verdict === verdict).length);
    const hit = row.filter((item) => item.data.result.verdict === EXPECTED[kind]).length;
    console.log(`${kind.padEnd(12)}${counts.map((n) => String(n).padStart(10)).join("")}   ${row.length ? `${Math.round(hit / row.length * 100)} %` : "—"}`); // sin respuestas de ese tipo no hay acierto que medir
  }
}
const average = (list) => list.length ? Math.round(list.reduce((sum, n) => sum + n, 0) / list.length) : 0;
const numbers = (pick) => graded.map(pick).filter((n) => Number.isFinite(n));
const p90 = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.9)] ?? 0;
console.log(`\nTokens por llamada: entrada ${average(numbers((g) => g.data.usage?.prompt))}, salida ${average(numbers((g) => g.data.usage?.output))}, razonamiento ${average(numbers((g) => g.data.usage?.thought))}.`);
console.log(`Tiempo de la IA: media ${average(numbers((g) => g.data.latencyMs))} ms, p90 ${p90(numbers((g) => g.data.latencyMs))} ms. Ida y vuelta: media ${average(numbers((g) => g.data.roundTripMs))} ms.`);
console.log(`Reintentos: ${graded.filter((g) => g.data.attempts > 1).length} respuestas necesitaron más de un intento. Modelos: ${[...new Set(graded.map((g) => g.data.model))].join(", ")}.`);

// Los casos que no cuadran, para leerlos uno a uno
const off = graded.filter((item) => item.data.result.verdict !== EXPECTED[item.kind]);
const report = cachePath("calibration-mismatches.tsv");
fs.writeFileSync(report, "frase\tidioma\ttipo\tesperado\tveredicto\tnota\trespuesta\tcomentario\n" + off.map((item) =>
  [item.body.ja, item.lang, item.kind, EXPECTED[item.kind], item.data.result.verdict, item.data.result.score, item.answer, item.data.result.feedback].join("\t")).join("\n") + "\n");
console.log(`No cuadran ${off.length} de ${graded.length}. Detalle en ${report}`);
