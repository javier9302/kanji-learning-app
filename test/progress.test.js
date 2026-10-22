const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../progress-core.js");

test("wordState: lo demostrado manda sobre lo supuesto", () => {
  assert.equal(P.wordState({ status: "mastered" }, false), "mastered");
  assert.equal(P.wordState({ status: "learning" }, true), "learning");
  assert.equal(P.wordState({ status: "pre_known", studied: true }, false), "learning");
  assert.equal(P.wordState({ status: "pre_known" }, false), "assumed");      // vista al leer, sin confirmar
  assert.equal(P.wordState(undefined, true), "assumed");                     // nivel aprobado en la evaluación
  assert.equal(P.wordState({ status: "unknown" }, true), "new");            // dijo que no la sabe
  assert.equal(P.wordState(undefined, false), "new");
});

test("kanjiState: significado o escritura lo dan por dominado; sus palabras, por supuesto", () => {
  assert.equal(P.kanjiState({ knowsMeaning: true }, false), "mastered");
  assert.equal(P.kanjiState({ canWrite: true }, false), "mastered");
  assert.equal(P.kanjiState({ studied: true }, true), "learning");
  assert.equal(P.kanjiState(undefined, true), "assumed");
  assert.equal(P.kanjiState(undefined, false), "new");
});

const breakdown = (rows) => Object.fromEntries(P.PC_LEVELS.map((level, i) => {
  const [mastered, assumed, total] = rows[i] || [0, 0, 10];
  return [level, { mastered, learning: 0, assumed, new: total - mastered - assumed, total }];
}));

test("levelBreakdown cuenta cada estado por nivel", () => {
  const items = [{ id: "a", level: "N5" }, { id: "b", level: "N5" }, { id: "c", level: "N4" }, { id: "x", level: "N9" }];
  const states = { a: "mastered", b: "new", c: "assumed" };
  const out = P.levelBreakdown(items, (id) => states[id]);
  assert.deepEqual(out.N5, { mastered: 1, learning: 0, assumed: 0, new: 1, total: 2 });
  assert.deepEqual(out.N4, { mastered: 0, learning: 0, assumed: 1, new: 0, total: 1 });
  assert.equal(out.N1.total, 0);
});

test("estimateLevel: un nivel cuenta como completo con el 80 % sabido, y también los anteriores", () => {
  assert.deepEqual(P.estimateLevel(breakdown([[3, 2, 10]])), { done: null, current: "N5", percent: 50 });
  assert.deepEqual(P.estimateLevel(breakdown([[5, 3, 10], [1, 0, 10]])), { done: "N5", current: "N4", percent: 10 });
  // Un N4 completo no sirve si N5 no lo está
  assert.equal(P.estimateLevel(breakdown([[2, 0, 10], [10, 0, 10]])).done, null);
  assert.deepEqual(P.estimateLevel(breakdown([[10, 0, 10], [10, 0, 10], [10, 0, 10], [10, 0, 10], [9, 0, 10]])),
    { done: "N1", current: null, percent: 100 });
  assert.equal(P.estimateLevel(breakdown([[7, 0, 10]]), 0.7).done, "N5");
});

test("readingSummary: textos, % conocido de los recientes y consultas por cada 100 palabras", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const sessions = [
    { textId: "a", finishedAt: now - 1000, clicks: { x: 1, y: 1 } },
    { textId: "b", finishedAt: now - 40 * 86400000, clicks: { z: 1 } },
    { textId: "a", finishedAt: now - 2000, clicks: {} },                 // releído
    { textId: "c", finishedAt: now - 3000, discarded: true, clicks: { w: 1 } }
  ];
  const texts = { a: { total: 50 }, b: { total: 100 } };
  const out = P.readingSummary(sessions, (id) => texts[id], (id) => ({ a: 90, b: 80 })[id] ?? null, now);
  assert.deepEqual(out, { texts: 2, texts30: 2, coverage: 87, lookups: 1.5 });
  assert.deepEqual(P.readingSummary([], () => null, () => null, now), { texts: 0, texts30: 0, coverage: null, lookups: null });
});

test("practiceSummary: días con actividad y aciertos en 30 días", () => {
  const now = new Date(2026, 9, 22, 12).getTime();
  const days = { "2026-10-22": { r: 10, c: 8 }, "2026-10-20": { r: 0, t: 3 }, "2026-09-01": { r: 50, c: 50 } };
  assert.deepEqual(P.practiceSummary(days, now), { activeDays: 2, reviews: 10, accuracy: 80 });
  assert.deepEqual(P.practiceSummary({}, now), { activeDays: 0, reviews: 0, accuracy: null });
});

test("weekKey y weekStart: semana ISO, también en el cambio de año", () => {
  assert.equal(P.weekKey(new Date(2026, 9, 22)), "2026-W43");
  assert.equal(P.weekKey(new Date(2027, 0, 1)), "2026-W53");   // viernes: aún es la última semana de 2026
  assert.equal(P.weekKey(new Date(2026, 0, 1)), "2026-W01");
  assert.equal(P.weekStart("2026-W43"), "2026-10-19");
  assert.equal(P.weekStart("2026-W01"), "2025-12-29");
});

test("snapshotOf y progressDelta: foto compacta y lo que cambió desde la anterior", () => {
  const profile = {
    vocab: breakdown([[5, 3, 10]]), kanji: breakdown([[2, 0, 10]]),
    vocabLevel: { done: "N5" }, kanjiLevel: { done: null },
    reading: { texts: 4, texts30: 2, coverage: 90, lookups: 3 }, practice: { activeDays: 5, reviews: 40, accuracy: 85 }
  };
  const snap = P.snapshotOf(profile, 123);
  assert.deepEqual(snap.vocab.N5, [5, 0, 3, 10]);
  assert.deepEqual(snap.level, { vocab: "N5", kanji: "" });
  const older = { ...snap, vocab: { N5: [2, 0, 3, 10] }, kanji: { N5: [2, 0, 0, 10] }, reading: { texts: 1 } };
  assert.deepEqual(P.progressDelta(snap, older), { words: 3, kanji: 0, texts: 3, grammar: null });
  assert.equal(P.progressDelta(snap, null), null);
  assert.equal(P.previousSnapshot({ "2026-W40": older, "2026-W42": snap, "2026-W43": snap }, "2026-W43"), snap);
  assert.equal(P.previousSnapshot({ "2026-W43": snap }, "2026-W43"), null);
});

test("estimateLevel con otra forma de contar y sin los niveles vacíos (gramática)", () => {
  const grammar = { N5: { mastered: 30, understood: 15, seen: 5, unseen: 5, total: 55 } };
  const share = (row) => (row.mastered + row.understood) / row.total;
  assert.deepEqual(P.estimateLevel(grammar, 0.8, share), { done: "N5", current: null, percent: 100 });
  assert.deepEqual(P.estimateLevel({ N5: { ...grammar.N5, mastered: 10 } }, 0.8, share), { done: null, current: "N5", percent: 45 });
});

test("la foto lleva la gramática si se calculó, y su diferencia con la anterior", () => {
  const base = {
    vocab: breakdown([[5, 3, 10]]), kanji: breakdown([[2, 0, 10]]), vocabLevel: { done: "N5" }, kanjiLevel: { done: null },
    reading: { texts: 1 }, practice: {}
  };
  assert.equal(P.snapshotOf(base).grammar, undefined);
  const snap = P.snapshotOf({ ...base, grammar: { N5: { mastered: 3, understood: 4, seen: 2, unseen: 46, total: 55 } }, grammarLevel: { done: null } });
  assert.deepEqual(snap.grammar, { N5: [3, 4, 2, 55] });
  assert.equal(snap.level.grammar, "");
  assert.equal(P.snapshotGrammar(snap), 7);
  assert.equal(P.progressDelta(snap, { ...snap, grammar: { N5: [1, 1, 0, 55] } }).grammar, 5);
});

const CONFIG = { weeklyWords: 35, weeklyKanji: 10, weeklyGrammar: 2, weeklyTexts: 3, preview: 8,
  minCoverage: 85, maxLookups: 8, minActiveDays: 12 };
const row = (known, total) => ({ mastered: known, assumed: 0, learning: 0, new: total - known, total });
const dim = (key, estimate, rows, items = []) => ({
  key, estimate, breakdown: rows, share: (r) => (r.mastered + r.assumed) / r.total, next: () => items
});
const calm = { reading: { texts30: 20, coverage: 95, lookups: 2 }, practice: { activeDays: 20 } };

test("missingFor: lo que falta para el 80 % de un nivel", () => {
  const share = (r) => (r.mastered + r.assumed) / r.total;
  assert.equal(P.missingFor(row(50, 100), share, 0.8), 30);
  assert.equal(P.missingFor(row(90, 100), share, 0.8), 0);
  assert.equal(P.missingFor(row(0, 87), share, 0.8), 70);   // 69,6 -> 70
  assert.equal(P.missingFor(undefined, share, 0.8), 0);
});

test("buildRoadmap: cada dimensión en su nivel; primero el nivel más bajo y, en él, la más floja", () => {
  const roadmap = P.buildRoadmap({
    dims: [
      dim("vocab", { done: "N5", current: "N4", percent: 40 }, { N4: row(200, 500) }, ["a", "b"]),
      dim("kanji", { done: null, current: "N5", percent: 70 }, { N5: row(61, 87) }, ["日", "月"]),
      dim("grammar", { done: null, current: "N5", percent: 30 }, { N5: row(16, 56) }, ["te-mo-ii", "yori", "tai"])
    ], ...calm
  }, CONFIG);
  assert.equal(roadmap.level, "N5");
  assert.equal(roadmap.focus, "grammar");
  assert.deepEqual(roadmap.steps.map((step) => [step.kind, step.level]), [["grammar", "N5"], ["kanji", "N5"], ["vocab", "N4"]]);
  assert.equal(roadmap.steps[2].missing, 200);  // 80 % de 500 = 400; sabe 200
  assert.deepEqual(roadmap.steps[0], { kind: "grammar", level: "N5", percent: 30, missing: 29, count: 2, items: ["te-mo-ii", "yori"] });
  assert.deepEqual(roadmap.steps[1].items, ["日", "月"]);
  assert.equal(roadmap.steps[1].count, 9);   // le faltan 9 kanjis: no se le piden 10
});

test("buildRoadmap: lectura y constancia", () => {
  const vocab = dim("vocab", { done: "N5", current: "N4", percent: 40 }, { N4: row(200, 500) });
  const kinds = (reading, practice) => P.buildRoadmap({ dims: [vocab], reading, practice }, CONFIG).steps.map((s) => s.kind);
  assert.deepEqual(kinds({ texts30: 1, coverage: 70, lookups: 3 }, { activeDays: 20 }), ["vocab", "easier"]);
  assert.deepEqual(kinds({ texts30: 1, coverage: 92, lookups: 12 }, { activeDays: 20 }), ["vocab", "easier"]);
  assert.deepEqual(kinds({ texts30: 2, coverage: 92, lookups: 3 }, { activeDays: 3 }), ["vocab", "read", "habit"]);
  assert.deepEqual(kinds({ texts30: 0, coverage: null, lookups: null }, { activeDays: 20 }), ["vocab", "read"]);
});

test("buildRoadmap: con todo completo no hay nivel objetivo, y sin gramática calculada se sigue con el resto", () => {
  const done = P.buildRoadmap({ dims: [dim("vocab", { done: "N1", current: null, percent: 100 }, {})], ...calm }, CONFIG);
  assert.deepEqual(done, { level: null, focus: null, steps: [] });
  const noGrammar = P.buildRoadmap({ dims: [dim("vocab", { done: null, current: "N5", percent: 10 }, { N5: row(50, 500) }), dim("grammar", null, {})], ...calm }, CONFIG);
  assert.deepEqual(noGrammar.steps.map((s) => s.kind), ["vocab"]);
});
