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

test("escribir: los nuevos, primero los de las palabras que mejor conoce (no la lista del nivel en orden)", () => {
  const state = writer({ seen: { 四: 3, 三: 1, 会: 3 } });
  assert.deepEqual(core.nextWritingKanji(state, W), { c: "四", level: "N5", kind: "new", seen: true });
  // Lo que más cerca le queda va antes que el nivel: 会 (lo conoce de palabras que domina) antes que 三
  assert.equal(core.nextWritingKanji({ ...state, avoid: "四" }, W).c, "会");
  // Un kanji de un nivel alto que ya ha visto también sale: lo conoce por sus palabras
  assert.equal(core.nextWritingKanji(writer({ seen: { 政: 3 } }), W).c, "政");
});

test("escribir: de simple a complejo, por importancia (en tramos) y trazos; sin vistos no hay nuevos", () => {
  const W0 = { ...W, unseenEvery: 0 };
  const strokes = { 二: 2, 三: 3, 四: 5, 会: 6 }, importance = { 二: 300, 三: 50, 四: 60, 会: 80 };
  const state = writer({ seen: { 二: 2, 三: 2, 四: 2, 会: 2 }, strokes: (c) => strokes[c], importance: (c) => importance[c] });
  const order = [];
  for (let avoid = ""; order.length < 4;) {
    const next = core.nextWritingKanji({ ...state, avoid, dueAt: (c) => order.includes(c) ? NOW + 9999 : null }, W0);
    order.push(next.c);
    avoid = next.c;
  }
  // 三, 四 y 会 están entre los 100 más importantes: de menos a más trazos; 二 (puesto 300), después
  assert.deepEqual(order, ["三", "四", "会", "二"]);
  // Sin nada visto: ningún kanji nuevo (y sin nada escrito, nada)
  assert.equal(core.nextWritingKanji(writer(), W0), null);
  // Un nivel aprobado con la prueba no sale aunque lo haya visto
  assert.equal(core.nextWritingKanji(writer({ seen: { 一: 3, 会: 1 }, skipped: ["N5"] }), W0).c, "会");
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

const { readingCredit, readingInterval } = require("../learning-core.js");
const READ = { rating: "hard", maxGrowth: 1.5, minDays: 1, flashcardEvery: 2 };

test("readingCredit: solo cuenta lo que toca repasar; tocarla es Otra vez", () => {
  const day = "2026-10-27";
  const due = { studied: true, nextReview: "2026-10-27" };
  assert.deepEqual(readingCredit({ rec: due, day }, READ), { result: "good", reason: "good" });
  assert.equal(readingCredit({ rec: { ...due, nextReview: "2026-10-20" }, day }, READ).result, "good"); // atrasada
  assert.equal(readingCredit({ rec: { ...due, nextReview: "2026-10-28" }, day }, READ).reason, "notDue"); // vence mañana
  assert.equal(readingCredit({ rec: { status: "learning" }, day }, READ).reason, "notDue");             // sin estudiar
  assert.equal(readingCredit({ rec: undefined, day }, READ).reason, "notDue");
  assert.deepEqual(readingCredit({ rec: due, tapped: true, day }, READ), { result: "again", reason: "tapped" });
  // «La conocía, solo comprobaba»: ni suma ni resta, aunque se tocara
  assert.deepEqual(readingCredit({ rec: due, tapped: true, checked: true, day }, READ), { result: null, reason: "checked" });
});

test("readingCredit: con furigana, dos veces el mismo día o tras dos lecturas seguidas no cuenta", () => {
  const day = "2026-10-27";
  const due = { studied: true, nextReview: "2026-10-26" };
  assert.equal(readingCredit({ rec: due, furigana: true, day }, READ).reason, "furigana");
  assert.equal(readingCredit({ rec: due, furigana: true, tapped: true, day }, READ).result, "again"); // la tocó: no la sabía
  assert.equal(readingCredit({ rec: { ...due, lastReadReview: day }, day }, READ).reason, "today");
  assert.equal(readingCredit({ rec: { ...due, readStreak: 1 }, day }, READ).result, "good");
  assert.equal(readingCredit({ rec: { ...due, readStreak: 2 }, day }, READ).reason, "flashcard");
});

test("readingInterval: lo de FSRS, pero como mucho 1,5 veces el intervalo anterior y al menos un día", () => {
  assert.equal(readingInterval(10, 30, READ), 15);
  assert.equal(readingInterval(10, 12, READ), 12); // FSRS ya da menos que el tope
  assert.equal(readingInterval(0, 4, READ), 1);    // recién aprendida: un día
  assert.equal(readingInterval(3, 0, READ), 1);
});

const { planToday } = require("../learning-core.js");
const TODAY = { writing: 4, sentences: 3 };
const day = (more = {}) => ({
  placed: true, story: { kind: "text", due: 3 }, read: false, due: 12, fresh: 5, answered: 0, goal: 20,
  writing: { available: true, done: 0 }, sentences: { available: true, done: 0 }, ...more
});

test("planToday: texto, Repasar, escribir y traducir, en ese orden; sin evaluación, solo ella", () => {
  const plan = planToday(day(), TODAY);
  assert.deepEqual(plan.steps.map((step) => step.kind), ["story", "reviews", "writing", "sentences"]);
  assert.equal(plan.next, "story");
  assert.equal(plan.steps[1].count, 17);
  assert.deepEqual(planToday(day({ placed: false }), TODAY), { steps: [{ kind: "placement", count: 1, done: false, progress: 0 }], next: "placement" });
});

test("planToday: lo hecho se deduce de lo de hoy; lo que no hay no sale", () => {
  const plan = planToday(day({ read: true, due: 0, answered: 15, writing: { available: true, done: 4 }, sentences: { available: true, done: 1 } }), TODAY);
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.done]), [["story", true], ["reviews", true], ["writing", true], ["sentences", false]]);
  assert.equal(plan.next, "sentences");
  // Sin texto posible, sin kanjis que escribir y sin frases: solo Repasar
  const bare = planToday(day({ story: { kind: "none" }, writing: { available: false, done: 0 }, sentences: { available: false, done: 0 } }), TODAY);
  assert.deepEqual(bare.steps.map((step) => step.kind), ["reviews"]);
  // Sin nada que repasar pero sin haber respondido nada hoy: queda por hacer (las nuevas)
  assert.equal(planToday(day({ due: 0, answered: 0 }), TODAY).steps[1].done, false);
  // Todo hecho
  assert.equal(planToday(day({ read: true, due: 0, answered: 3, writing: { available: false, done: 2 }, sentences: { available: true, done: 3 } }), TODAY).next, null);
});
