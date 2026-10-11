const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDictQuery, rankResults, dictBankEntry, dictGloss, lookupRecency, promptLearning } = require("../dictionary.js");
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

test("lookupRecency: 1 el día de la consulta, baja de forma lineal y no pasa de 0", () => {
  const DAY = 86400000, now = 100 * DAY;
  assert.equal(lookupRecency(now, now, 14), 1);
  assert.equal(lookupRecency(now - 7 * DAY, now, 14), 0.5);
  assert.equal(lookupRecency(now - 14 * DAY, now, 14), 0);
  assert.equal(lookupRecency(now - 30 * DAY, now, 14), 0);
  assert.equal(lookupRecency(now + DAY, now, 14), 1);   // reloj adelantado en otro dispositivo
  assert.equal(lookupRecency(0, now, 14), 0);
  assert.equal(lookupRecency(now, now, 0), 0);          // con 0 días la ventaja está apagada
});

test("promptLearning: las buscadas primero (la más reciente antes), nunca una conocida", () => {
  const records = [
    { lemma: "a", status: "learning", lastSeen: 5 },
    { lemma: "b", status: "unknown", origin: "diccionario", lastSeen: 10 },
    { lemma: "c", status: "unknown", origin: "diccionario", lastSeen: 20 },
    { lemma: "d", status: "mastered", origin: "diccionario", lastSeen: 30 },
    { lemma: "e", status: "unknown", origin: "lectura", lastSeen: 40 },
    { lemma: "f", status: "learning", origin: "diccionario", lastSeen: 1 },
    { lemma: "g", status: "learning", origin: "diccionario", studied: true, canReadKanji: true, lastSeen: 50 },
    { lemma: "h", status: "pre_known", origin: "diccionario", lastSeen: 60 }
  ];
  // "g" ya la lee bien: no va con las buscadas, pero sigue en "aprendiendo" como hasta ahora
  assert.deepEqual(promptLearning(records).map((w) => w.lemma), ["c", "b", "f", "a", "g"]);
  assert.deepEqual(promptLearning(records, 2).map((w) => w.lemma), ["c", "b"]);
});
