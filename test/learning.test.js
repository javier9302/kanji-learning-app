const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../learning-core.js");
const { loadBank } = require("../tools/lib/bank.js");
const { loadStudyConfig } = require("../tools/lib/config.js");

const BANK = loadBank();
const CONFIG = loadStudyConfig();
const ctx = (level, known = []) => ({ level, known: new Set(known), kanjiLevel: (c) => BANK.kanjiLevel(c), knownNeeded: CONFIG.newWordKanji.knownNeeded });
const word = (id) => BANK.words.get(id);
const levelOf = (c) => BANK.kanjiLevel(c);

/* Palabras reales del banco con la combinación que se quiere probar */
const find = (test) => [...BANK.words.values()].find(test);
const kanjiLevels = (entry) => entry.kanji.map(levelOf);
const above = (lv, max) => !lv || BANK.LEVELS.indexOf(lv) > BANK.LEVELS.indexOf(max);

test("palabras nuevas: lo que cuenta es el nivel de los kanjis, no el de la palabra", () => {
  // Una palabra de N5 con un solo kanji de un nivel superior no sale a quien está en N5
  const basicHard = find((w) => w.level === "N5" && w.kanji.length === 1 && above(levelOf(w.kanji[0]), "N5"));
  assert.ok(basicHard, "el banco tiene palabras de N5 con un kanji superior");
  assert.equal(core.kanjiGate(basicHard, ctx("N5")).ok, false);
  assert.deepEqual(core.kanjiGate(basicHard, ctx("N5")).above, basicHard.kanji);
  // …pero sí si ese kanji ya lo conoce
  assert.equal(core.kanjiGate(basicHard, ctx("N5", basicHard.kanji)).ok, true);
  // Una palabra de N3 hecha solo con kanjis de N5 sí sale a quien está en N5
  const easyHigh = find((w) => w.level === "N3" && w.kanji.length > 1 && kanjiLevels(w).every((lv) => lv === "N5"));
  assert.ok(easyHigh, "el banco tiene palabras de N3 con kanjis de N5");
  assert.equal(core.kanjiGate(easyHigh, ctx("N5")).ok, true);
});

test("palabras de varios kanjis: pueden llevar uno superior si conoce otro y la palabra es de su nivel", () => {
  const mixed = find((w) => w.level === "N5" && w.kanji.length > 1 &&
    kanjiLevels(w).some((lv) => lv === "N5") && kanjiLevels(w).some((lv) => above(lv, "N5")));
  assert.ok(mixed, "el banco tiene palabras de N5 con un kanji de N5 y otro superior");
  const easy = mixed.kanji.find((c) => levelOf(c) === "N5");
  assert.equal(core.kanjiGate(mixed, ctx("N5")).ok, false);              // no conoce ninguno
  assert.equal(core.kanjiGate(mixed, ctx("N5", [easy])).ok, true);       // conoce el de N5
  // La misma regla no vale si la palabra es de un nivel superior al del usuario
  const mixedHigh = { ...mixed, level: "N2" };
  assert.equal(core.kanjiGate(mixedHigh, ctx("N5", [easy])).ok, false);
  // Ni para una palabra de un solo kanji
  assert.equal(core.kanjiGate({ kanji: ["鬱"], level: "N5" }, ctx("N5", ["学"])).ok, false);
});

test("kanjiGate con datos inventados: casos límite", () => {
  const levels = { 学: "N5", 校: "N5", 憂: "N1", 鬱: null };
  const c = (level, known = []) => ({ level, known: new Set(known), kanjiLevel: (k) => levels[k] ?? null, knownNeeded: 1 });
  assert.equal(core.kanjiGate({ kanji: ["学", "校"], level: "N1" }, c("N5")).ok, true);   // palabra N1, kanjis N5
  assert.equal(core.kanjiGate({ kanji: ["鬱"], level: "N5" }, c("N1")).ok, false);       // kanji fuera del banco: nunca "de su nivel"
  assert.equal(core.kanjiGate({ kanji: ["学", "鬱"], level: "N5" }, c("N5", ["学"])).ok, true);
  assert.equal(core.kanjiGate({ kanji: ["学", "鬱"], level: null }, c("N5", ["学"])).ok, false); // de fuera del banco: sin nivel
  assert.equal(core.kanjiGate({ kanji: [], level: "N5" }, c("N5")).ok, true);
  assert.equal(core.kanjiGate({ kanji: ["憂", "鬱"], level: "N5" }, { ...c("N5", ["憂"]), knownNeeded: 2 }).ok, false);
});

/* ---------- Escribir ---------- */

const BY_LEVEL = { N5: ["一", "二", "三"], N4: ["会", "同"], N3: ["政"], N2: [], N1: [] };
const writer = (written = [], extra = {}) => ({
  kanjiByLevel: BY_LEVEL, written: (c) => written.includes(c), skipped: [], useful: () => false,
  lastWritten: (c) => extra.last?.[c] || 0, turn: 1, avoid: "", ...extra
});
const W = { reviewEvery: 5, test: { size: 3, pass: 2, maxMistakes: 1 } };

test("escribir: no salen kanjis de un nivel superior hasta terminar el actual", () => {
  assert.equal(core.writingLevel(BY_LEVEL, () => false), "N5");
  assert.equal(core.writingLevel(BY_LEVEL, (c) => ["一", "二"].includes(c)), "N5");
  assert.equal(core.writingLevel(BY_LEVEL, (c) => ["一", "二", "三"].includes(c)), "N4");
  assert.equal(core.writingLevel(BY_LEVEL, () => true), null);
  // Escribiendo de uno en uno, todos los de N5 salen antes que cualquiera de N4
  const written = [], order = [];
  for (let turn = 1; turn <= 6; turn++) {
    const next = core.nextWritingKanji(writer(written, { turn, avoid: order[order.length - 1], reviewEvery: 0 }), { ...W, reviewEvery: 0 });
    if (!next) break;
    order.push(next.c);
    if (!next.review) written.push(next.c);
  }
  assert.deepEqual(order, ["一", "二", "三", "会", "同", "政"]);
});

test("escribir: un nivel aprobado con la prueba se salta", () => {
  assert.equal(core.writingLevel(BY_LEVEL, () => false, ["N5"]), "N4");
  const next = core.nextWritingKanji(writer([], { skipped: ["N5"] }), W);
  assert.equal(next.level, "N4");
});

test("escribir: cada reviewEvery kanjis sale un repaso, el que hace más que no se escribe", () => {
  const last = { 一: 3000, 二: 1000 };
  const state = writer(["一", "二"], { last, turn: 5 });
  const next = core.nextWritingKanji(state, W);
  assert.deepEqual(next, { c: "二", level: "N5", review: true });
  // En los demás turnos, uno nuevo del nivel actual
  assert.deepEqual(core.nextWritingKanji({ ...state, turn: 4 }, W), { c: "三", level: "N5", review: false });
  // Sin nada escrito todavía no hay repaso posible
  assert.equal(core.nextWritingKanji(writer([], { turn: 5 }), W).review, false);
  // Con todo escrito, solo repasos
  assert.equal(core.nextWritingKanji(writer(Object.values(BY_LEVEL).flat(), { turn: 2 }), W).review, true);
});

test("escribir: primero los kanjis de palabras que conoce", () => {
  const next = core.nextWritingKanji(writer([], { useful: (c) => c === "三" }), W);
  assert.equal(next.c, "三");
});

test("prueba para saltar un nivel: cuenta solo lo escrito sin ayuda y con pocos fallos", () => {
  const results = [
    { c: "一", mistakes: 0, shown: false, hinted: false },
    { c: "二", mistakes: 1, shown: false, hinted: false },
    { c: "三", mistakes: 0, shown: false, hinted: true }
  ];
  assert.deepEqual(core.writingTestResult(results, W.test), { passed: true, good: ["一", "二"], total: 3 });
  results[1].mistakes = 2;
  assert.equal(core.writingTestResult(results, W.test).passed, false);
  assert.equal(core.writingTestResult(results.slice(0, 1), W.test).passed, false); // prueba incompleta
  // Los kanjis de la prueba: de los que aún no sabe escribir, sin repetir
  const list = core.writingTestKanji(["一", "二", "三", "四", "五"], (c) => c === "一", 3, () => 0.5);
  assert.equal(list.length, 3);
  assert.ok(!list.includes("一") && new Set(list).size === 3);
});
