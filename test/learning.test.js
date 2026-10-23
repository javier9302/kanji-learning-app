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

const BY_LEVEL = { N5: ["一", "二", "三", "四"], N4: ["会", "同"], N3: ["政"], N2: [], N1: [] };
const NOW = 1_000_000_000;
/* due: { 一: ms } kanjis ya escritos y cuándo vencen; seen: { 三: 2 } lo que ha visto */
const writer = ({ due = {}, seen = {}, ...extra } = {}) => ({
  now: NOW, kanjiByLevel: BY_LEVEL, dueAt: (c) => c in due ? due[c] : null, seen: (c) => seen[c] || 0,
  skipped: [], newToday: 0, avoid: "", ...extra
});
const W = { newPerDay: 3, unseenEvery: 3, rating: { forgiveMistakes: 1, againMistakes: 3 }, test: { size: 3, pass: 2, maxMistakes: 1 } };

test("escribir: el nivel de escritura es el primero sin terminar ni aprobar", () => {
  assert.equal(core.writingLevel(BY_LEVEL, () => false), "N5");
  assert.equal(core.writingLevel(BY_LEVEL, (c) => ["一", "二", "三"].includes(c)), "N5");
  assert.equal(core.writingLevel(BY_LEVEL, (c) => BY_LEVEL.N5.includes(c)), "N4");
  assert.equal(core.writingLevel(BY_LEVEL, () => false, ["N5"]), "N4");
  assert.equal(core.writingLevel(BY_LEVEL, () => true), null);
});

test("escribir: primero los repasos que vencieron, el más atrasado antes", () => {
  const next = core.nextWritingKanji(writer({ due: { 一: NOW - 10, 二: NOW - 500, 三: NOW + 999 } }), W);
  assert.deepEqual(next, { c: "二", level: "N5", kind: "review", seen: true });
  // Los que aún no vencen no salen como repaso
  assert.equal(core.nextWritingKanji(writer({ due: { 三: NOW + 999 } }), W).kind, "new");
});

test("escribir: los nuevos, primero los que ya ha visto (no la lista del nivel en orden)", () => {
  const state = writer({ seen: { 四: 3, 三: 1, 会: 3 } });
  assert.deepEqual(core.nextWritingKanji(state, W), { c: "四", level: "N5", kind: "new", seen: true });
  // A igual nivel, el que más cerca le queda; un nivel más bajo va antes
  assert.equal(core.nextWritingKanji({ ...state, avoid: "四" }, W).c, "三");
  // Un kanji visto muy por encima de su nivel no sale todavía
  assert.equal(core.nextWritingKanji(writer({ seen: { 政: 3 } }), W).c, "一");
});

test("escribir: de vez en cuando uno sin ver de su nivel, para completarlo; sin vistos, solo esos", () => {
  const seen = { 三: 2, 四: 2, 会: 2 };
  assert.equal(core.nextWritingKanji(writer({ seen, newToday: 0 }), W).c, "三");
  assert.deepEqual(core.nextWritingKanji(writer({ seen, newToday: 2 }), W), { c: "一", level: "N5", kind: "new", seen: false });
  assert.equal(core.nextWritingKanji(writer(), W).c, "一");
});

test("escribir: con el tope de nuevos del día, práctica extra con el que vence antes", () => {
  const state = writer({ due: { 一: NOW + 5000, 二: NOW + 100 }, seen: { 三: 3 }, newToday: 3 });
  assert.deepEqual(core.nextWritingKanji(state, W), { c: "二", level: "N5", kind: "extra", seen: true });
  // Sin nada escrito y sin poder empezar uno nuevo, no hay nada
  assert.equal(core.nextWritingKanji(writer({ newToday: 3 }), W), null);
});

test("escribir: un nivel aprobado con la prueba se salta al elegir uno sin ver", () => {
  const next = core.nextWritingKanji(writer({ skipped: ["N5"] }), W);
  assert.deepEqual(next, { c: "会", level: "N4", kind: "new", seen: false });
});

test("escribir: la valoración perdona el primer fallo y castiga pistas y Mostrar", () => {
  const rate = (attempt) => core.writingRating(attempt, W.rating);
  assert.equal(rate({ mistakes: 0 }), "good");
  assert.equal(rate({ mistakes: 1 }), "good");            // el primer fallo no cuenta
  assert.equal(rate({ mistakes: 2 }), "hard");
  assert.equal(rate({ mistakes: 0, hinted: true }), "hard");
  assert.equal(rate({ mistakes: 4 }), "again");
  assert.equal(rate({ mistakes: 0, shown: true }), "again");
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
