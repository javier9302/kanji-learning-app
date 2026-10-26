const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../ranking-core.js");
const K = require("../kanji-core.js");

const config = {
  frequencyMaxRank: 6000,
  weights: { frequency: 1, bridge: 1.5, unlock: 0.6, coverage: 0.8, topic: 0 },
  bridge: { one: 1, kanjiAndReading: 0.8, readingsOnly: 0.6, many: 0.4, nothingNew: 0.5, twoKanji: -1 },
  diversity: { lambda: 0.7, pool: 300 }, unlockShown: 0.6
};

/* Banco de prueba: 名前 es lo único que conoce. Las de dos kanjis nuevos son más
   frecuentes, para que la frecuencia no explique el resultado. */
const bank = [
  { id: "名前|なまえ", kanji: ["名", "前"], pairs: [["名", "な"], ["前", "まえ"]], rank: 300 },
  { id: "有名|ゆうめい", kanji: ["有", "名"], pairs: [["有", "ゆう"], ["名", "めい"]], rank: 900 },
  { id: "前置き|まえおき", kanji: ["前", "置"], pairs: [["前", "まえ"], ["置", "お"]], rank: 2500 },
  { id: "電話|でんわ", kanji: ["電", "話"], pairs: [["電", "でん"], ["話", "わ"]], rank: 120 },
  { id: "自転車|じてんしゃ", kanji: ["自", "転", "車"], pairs: [["自", "じ"], ["転", "てん"], ["車", "しゃ"]], rank: 150 },
  { id: "有る|ある", kanji: ["有"], pairs: [["有", "あ"]], rank: 50 },
  { id: "午前|ごぜん", kanji: ["午", "前"], pairs: [["午", "ご"], ["前", "ぜん"]], rank: 700 }
];
const info = new Map([["名", { readings: [["めい", 21, 14], ["な", 12, 11]] }], ["前", { readings: [["まえ", 11, 8], ["ぜん", 10, 7]] }]]);

function rank(knownIds) {
  const known = bank.filter((word) => knownIds.includes(word.id));
  const states = K.kanjiStates({ kanji: info, knownWords: known.map((word) => ({ id: word.id, readings: word.pairs })),
    meaningKnown: () => true, config: { relevantMinWords: 2 } });
  const unknown = bank.filter((word) => !knownIds.includes(word.id));
  const ctx = R.rankingContext(states, unknown);
  const scored = R.scoreRanking(unknown, ctx, config).sort((a, b) => b.score - a.score);
  return { ctx, scored, order: scored.map((item) => item.id.split("|")[0]) };
}

test("con 名前: 有名 y 前置き van antes que las palabras con dos kanjis nuevos, aunque sean más frecuentes", () => {
  const { order } = rank(["名前|なまえ"]);
  for (const good of ["有名", "前置き"]) {
    for (const bad of ["電話", "自転車"]) assert.ok(order.indexOf(good) < order.indexOf(bad), `${good} antes que ${bad}: ${order}`);
  }
});

test("wordNovelty y bridgeScore: un kanji nuevo, una lectura nueva o las dos", () => {
  const { ctx, scored } = rank(["名前|なまえ"]);
  const byId = Object.fromEntries(scored.map((item) => [item.id.split("|")[0], item]));
  assert.deepEqual(byId.有名.novelty.newKanji, ["有"]);
  assert.deepEqual(byId.有名.novelty.newReadings, [["名", "めい"]]);
  assert.deepEqual(byId.有名.novelty.completes, [["名", "めい"]]); // 名 ya solo necesita めい
  assert.equal(byId.有名.parts.bridge, 0.8);
  assert.equal(byId.前置き.parts.bridge, 1);           // 置 nuevo; 前 まえ ya vista
  assert.equal(byId.午前.parts.bridge, 0.8);           // 午 nuevo y la lectura ぜん de 前
  assert.equal(byId.電話.parts.bridge, -1);
  assert.equal(R.bridgeScore(R.wordNovelty({ kanji: ["名"], pairs: [["名", "な"]] }, ctx), config.bridge), 0.5); // nada nuevo
});

test("coverage: completar la última lectura vale más que una de varias", () => {
  const { scored } = rank(["名前|なまえ"]);
  const byId = Object.fromEntries(scored.map((item) => [item.id.split("|")[0], item]));
  assert.equal(byId.有名.parts.coverage, 1);  // la única que le falta a 名
  assert.equal(byId.前置き.parts.coverage, 0);
});

test("unlock: un kanji nuevo que sale en otras palabras frecuentes vale más", () => {
  const { scored } = rank(["名前|なまえ"]);
  const byId = Object.fromEntries(scored.map((item) => [item.id.split("|")[0], item]));
  // 有 sale también en 有る (puesto 50); 置 no sale en ninguna otra
  assert.ok(byId.有名.parts.unlock > byId.前置き.parts.unlock);
  assert.equal(byId.前置き.parts.unlock, 0);
});

test("diversify: no salen seguidas dos con el mismo kanji nuevo si hay otra casi igual de buena", () => {
  const item = (id, score, newKanji) => ({ id, score, novelty: { newKanji, newReadings: [], knownKanji: [], completes: [] } });
  const sorted = [item("a", 10, ["有"]), item("b", 9.9, ["有"]), item("c", 9.8, ["置"]), item("d", 1, ["山"])];
  assert.deepEqual(R.diversify(sorted, { lambda: 0.7, pool: 300 }).map((x) => x.id), ["a", "c", "b", "d"]);
  assert.deepEqual(R.diversify(sorted, { lambda: 1, pool: 300 }).map((x) => x.id), ["a", "b", "c", "d"]); // solo puntuación
});

test("rankingReasons: lo nuevo, lo que completa y lo conocido", () => {
  const { scored } = rank(["名前|なまえ"]);
  const byId = Object.fromEntries(scored.map((item) => [item.id.split("|")[0], item]));
  assert.deepEqual(R.rankingReasons(byId.有名, config).map(([key]) => key), ["completes", "newKanjiUnlocks"]);
  assert.deepEqual(R.rankingReasons(byId.前置き, config), [["newKanji", { kanji: "置" }], ["knownKanji", { kanji: "前" }]]);
  assert.deepEqual(R.rankingReasons(byId.電話, config), [["manyKanji", { n: 2, kanji: "電、話" }]]);
});

test("parseQueueText: el formato de la app, una lista sin más o una palabra por línea", () => {
  assert.deepEqual(R.parseQueueText('{"format":"kanji-app-queue","version":1,"note":"escuela","words":["有名|ゆうめい","前置き"]}'),
    { items: ["有名|ゆうめい", "前置き"], note: "escuela" });
  assert.deepEqual(R.parseQueueText('["有名", {"w":"角","r":"かど"}]').items, ["有名", { w: "角", r: "かど" }]);
  assert.deepEqual(R.parseQueueText("1. 有名\n2) 前置き\n- 午前、教室").items, ["有名", "前置き", "午前", "教室"]);
  assert.throws(() => R.parseQueueText("  "), /empty/);
  assert.throws(() => R.parseQueueText('{"words": []}'), /format/);
});

test("resolveQueue: valida cada palabra contra el banco y dice qué no vale", () => {
  const entries = [
    { id: "有名|ゆうめい", w: "有名", r: "ゆうめい" }, { id: "前置き|まえおき", w: "前置き", r: "まえおき" },
    { id: "角|かど", w: "角", r: "かど" }, { id: "角|つの", w: "角", r: "つの" },
    { id: "有る|ある", w: "有る", r: "ある", kana: true }, { id: "名前|なまえ", w: "名前", r: "なまえ" },
    { id: "午前|ごぜん", w: "午前", r: "ごぜん" }
  ];
  const lookup = {
    byId: (id) => entries.find((entry) => entry.id === id) || null,
    byWriting: (w) => entries.filter((entry) => entry.w === w),
    state: (id) => ({ "名前|なまえ": "known", "午前|ごぜん": "studied" })[id] || null
  };
  const result = R.resolveQueue(["有名|ゆうめい", "前置き", "角", { w: "角", r: "カド" }, "有名", "有る", "名前", "午前", "存在しない"], lookup);
  assert.deepEqual(result.ids, ["有名|ゆうめい", "前置き|まえおき", "角|かど"]);
  assert.deepEqual(result.ambiguous, [{ item: "角", options: ["角|かど", "角|つの"] }]);
  assert.deepEqual(result.duplicates, ["有名|ゆうめい"]);
  assert.deepEqual(result.skipped, [{ id: "有る|ある", reason: "kana" }, { id: "名前|なまえ", reason: "known" }, { id: "午前|ごぜん", reason: "studied" }]);
  assert.deepEqual(result.notFound, ["存在しない"]);
});
