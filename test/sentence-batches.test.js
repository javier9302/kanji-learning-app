const test = require("node:test");
const assert = require("node:assert/strict");
const { renderSentencePrompt, parseResponse, promptTargets } = require("../tools/lib/sentence-batches.js");

const WORDS = [
  { id: "水|みず", w: "水", r: "みず", meaning: "water" },
  { id: "角|かど", w: "角", r: "かど", meaning: "corner" }
];
const prompt = (vocabulary = { levels: ["N5"], words: ["水", "角", "飲む"] }) =>
  renderSentencePrompt({ batch: "n5-001", level: "N5", words: WORDS, vocabulary });

test("el prompt lleva cada palabra con su lectura, el nivel, las reglas y el formato de salida", () => {
  const text = prompt();
  assert.ok(text.includes('1. 水|みず  — 水 read みず — "water"'));
  assert.ok(text.includes('2. 角|かど  — 角 read かど — "corner"'));
  assert.ok(text.includes("JLPT N5") && text.includes("水、角、飲む"));
  assert.ok(text.includes("between 5 and 12 units") && text.includes("Write 2 different sentences"));
  assert.ok(text.includes("with 4 sentences") && text.includes('{"batch":"n5-001"'));
  assert.ok(/EXACTLY the reading given/.test(text) && /No romaji/.test(text));
  assert.ok(!/\$\{/.test(text)); // ninguna variable sin sustituir
});

test("en niveles altos no se da la lista de vocabulario, solo el nivel", () => {
  const text = prompt({ levels: ["N5", "N4", "N3"], words: null });
  assert.ok(text.includes("only words from JLPT N5, N4, N3"));
  assert.ok(!text.includes("use ONLY these words"));
});

test("promptTargets lee las palabras de una tanda desde su prompt", () => {
  assert.deepEqual(promptTargets(prompt()), ["水|みず", "角|かど"]);
});

test("parseResponse acepta la respuesta tal como se pega", () => {
  const sentences = [{ targets: ["水|みず"], ja: "水|を|飲みます|。", en: "I drink water.", es: "Bebo agua." }];
  const json = JSON.stringify({ batch: "n5-001", sentences });
  assert.deepEqual(parseResponse(json), sentences);
  assert.deepEqual(parseResponse("```json\n" + json + "\n```"), sentences);
  assert.deepEqual(parseResponse("Aquí tienes:\n" + json + "\n¡Suerte!"), sentences);
  assert.deepEqual(parseResponse(JSON.stringify(sentences)), sentences); // solo la lista
});

test("parseResponse explica qué falla", () => {
  assert.throws(() => parseResponse('{"batch":"n5-001","sentences":[{"ja":"水|'), /no es un JSON válido.*cortó/);
  assert.throws(() => parseResponse('{"batch":"n5-001"}'), /falta la lista/);
  assert.throws(() => parseResponse(""), /no es un JSON válido/);
});
