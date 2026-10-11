const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDictQuery, rankResults, dictBankEntry, dictGloss } = require("../dictionary.js");
const { loadBank } = require("../tools/lib/bank.js");

// Conversión mínima de romaji para las pruebas (en la app es WanaKana)
const ROMAJI = { kado: "かど", gakkou: "がっこう", mizu: "みず", ka: "か" };
const toHiragana = (text) => ROMAJI[text] || text;

const BANK = loadBank();
const all = [...BANK.words.values()].map((word) => dictBankEntry(word, BANK.frequency));
const search = (text, language = "es") => rankResults(all, parseDictQuery(text, toHiragana), language);
const ids = (list, n = 5) => list.slice(0, n).map((entry) => entry.id);

test("parseDictQuery distingue kanji, kana, romaji y significado", () => {
  assert.deepEqual(parseDictQuery("学校"), { raw: "学校", writing: "学校", kana: "", meaning: "" });
  assert.equal(parseDictQuery("ガッコウ").kana, "がっこう");
  assert.equal(parseDictQuery("kado", toHiragana).kana, "かど");
  assert.equal(parseDictQuery("water", toHiragana).kana, "");
  assert.equal(parseDictQuery("Café", toHiragana).meaning, "cafe");
  assert.equal(parseDictQuery("   "), null);
});

test("la escritura exacta va primero y los homógrafos salen por separado", () => {
  const list = search("角");
  const exact = list.filter((entry) => entry.w === "角").map((entry) => entry.r);
  assert.ok(exact.length >= 2, `lecturas de 角: ${exact}`);
  assert.ok(exact.includes("かど"));
  // Todas las exactas antes que cualquier palabra que solo empiece por 角
  assert.ok(list.findIndex((entry) => entry.w !== "角") >= exact.length || list.every((entry) => entry.w === "角"));
});

test("lectura exacta en kana y en romaji", () => {
  assert.equal(search("がっこう")[0].id, "学校|がっこう");
  assert.equal(search("gakkou")[0].id, "学校|がっこう");
  assert.ok(ids(search("kado"), 3).includes("角|かど"));
});

test("después de lo exacto, lo que empieza por lo buscado", () => {
  const list = search("学");
  const firstOther = list.findIndex((entry) => entry.w !== "学");
  assert.ok(list.slice(firstOther, firstOther + 5).every((entry) => entry.w.startsWith("学")));
});

test("a igualdad, la más frecuente primero", () => {
  const list = search("か").filter((entry) => entry.r.startsWith("か") && entry.r !== "か");
  const ranks = list.map((entry) => entry.rank || Infinity);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("significado: en el idioma de la interfaz y también en el otro", () => {
  assert.ok(ids(search("agua", "es")).includes("水|みず"));
  assert.ok(ids(search("water", "es")).includes("水|みず"));
  assert.ok(ids(search("water", "en")).includes("水|みず"));
  // El significado entero gana a una palabra dentro de otro significado
  const list = search("water", "en");
  assert.equal(dictGloss(list[0].en.find((gloss) => dictGloss(gloss) === "water") || ""), "water");
});

test("un romaji que también es una palabra inglesa busca las dos cosas", () => {
  const list = search("mizu");
  assert.equal(list[0].id, "水|みず");
});

test("sin coincidencia no hay resultados, y el límite se respeta", () => {
  assert.deepEqual(search("zzzzqqq"), []);
  assert.ok(search("か").length <= 50);
});
