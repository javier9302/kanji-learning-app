/* Prueba de humo en un navegador de verdad (Chrome sin ventana), como invitado:
   la app arranca sin errores, se hace un repaso y se lee un texto.
     node tools/smoke.mjs
   No inicia sesión: la cuenta y la sincronización se prueban a mano.
   CHROME_PATH cambia el navegador que se usa. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".gz": "application/gzip" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

// En la integración continua (GitHub Actions) Chrome no puede usar su sandbox
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ["--no-sandbox"] : [] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  // Sin red hacia Supabase o un 404 de un recurso opcional no son fallos de la app
  if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(`console: ${message.text()}`);
});

const steps = [];
const step = async (name, run) => {
  try { await run(); steps.push(`ok   ${name}`); } catch (error) { steps.push(`FAIL ${name}: ${error.message}`); errors.push(name); }
};
const check = (value, message) => { if (!value) throw new Error(message); };

await page.goto(url, { waitUntil: "networkidle2" });

await step("la app arranca", async () => {
  check(await page.evaluate(() => typeof BANK === "object" && BANK.words.size > 0 && !!db), "no cargó el banco o la base local");
  // Se salta la evaluación inicial: nivel N5 sin vocabulario supuesto
  await page.evaluate(async () => {
    meta.reading = { level: "N5", assumed: "", placedAt: Date.now(), updatedAt: Date.now() };
    await saveMeta();
  });
});

await step("repaso: una palabra escrita y valorada", async () => {
  await page.evaluate(() => { $("studyMode").value = "type"; switchView("study"); });
  await page.click("#startBtn");
  await page.waitForSelector("#readingInput");
  const reading = await page.evaluate(() => session.queue[0].entry.r);
  await page.evaluate((value) => { $("readingInput").value = value; }, reading);
  await page.click("#checkBtn");
  await page.waitForSelector('[data-rate="good"]');
  await page.click('[data-rate="good"]');
  await page.waitForFunction(() => !session || session.queue.length && !document.querySelector('[data-rate]'));
  const studied = await page.evaluate(() => [...userWords.values()].filter((w) => w.studied && w.fsrs).length);
  check(studied === 1, `palabras estudiadas: ${studied}`);
});

await step("lectura: guardar el ejemplo, abrirlo, tocar una palabra y terminar", async () => {
  await page.evaluate(() => { session = null; document.body.classList.remove("studying"); switchView("library"); });
  await page.click("#sampleTextBtn");
  await page.click("#addTextBtn");
  await page.waitForSelector("[data-read-text]", { timeout: 60000 }); // el banco entero se descarga aquí
  await page.click("[data-read-text]");
  await page.waitForSelector(".tok", { timeout: 5000 });
  await page.click(".tok");
  await page.waitForSelector(".pop-word", { timeout: 5000 });
  await page.evaluate(() => $("readerFinishBtn").click()); // en pantallas pequeñas el panel lo tapa
  await page.waitForFunction(() => !reader, { timeout: 5000 });
  check(await page.evaluate(() => texts.length === 1 && !!texts[0].readAt), "el texto no quedó como leído");
});

await step("cuenta: el diálogo de sesión se abre", async () => {
  if (!await page.evaluate(() => !!sb)) return; // sin config.js no hay cuentas
  await page.evaluate(() => openAuth("login"));
  check(await page.evaluate(() => $("authDialog").open), "no se abrió");
  await page.evaluate(() => $("authDialog").close());
});

// Pasos propios de cada función nueva: tools/smoke-extra.mjs los añade aquí
const extra = path.join(ROOT, "tools/smoke-extra.mjs");
if (fs.existsSync(extra)) await (await import(extra)).default({ page, step, check });

// La página de administración carga sin errores (sin sesión: solo se ve el acceso)
await step("administración: la página carga con todas sus pestañas", async () => {
  await page.goto(`${url}admin.html`, { waitUntil: "networkidle2" });
  const state = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll("[data-admin]")].map((tab) => tab.dataset.admin),
    panels: ["adminPanel", "wordsPanel", "logsPanel", "gradesPanel"].every((id) => !!document.getElementById(id)),
    functions: typeof loadGrades === "function" && typeof exportGrades === "function" && typeof loadLogs === "function"
  }));
  check(state.tabs.join() === "texts,words,logs,grades" && state.panels && state.functions, JSON.stringify(state));
});

await browser.close();
server.close();
console.log(steps.join("\n"));
if (errors.length) {
  console.error(`\n${errors.length} problema(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nPrueba de humo correcta.");
