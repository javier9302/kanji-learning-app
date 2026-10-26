const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../kanji-core.js");
const { kanjiVariants } = require("../sentences-core.js");

const config = { relevantMinWords: 2 };

test("normalizeKanjiReading: lecturas de KANJIDIC2, con rendaku y con okurigana dentro", () => {
  const ue = { on: ["ジョウ", "ショウ"], kun: ["うえ", "あ.げる", "あ.がる"] };
  assert.equal(K.normalizeKanjiReading("じょう", ue, kanjiVariants), "じょう");
  assert.equal(K.normalizeKanjiReading("あげ", ue, kanjiVariants), "あ");      // 売上 うりあげ
  const uru = { on: ["バイ"], kun: ["う.る", "う.れる"] };
  assert.equal(K.normalizeKanjiReading("うり", uru, kanjiVariants), "う");     // forma en -i de 売る
  assert.equal(K.normalizeKanjiReading("ぎ", { on: ["セツ"], kun: ["き.る"] }, kanjiVariants), "き"); // rendaku
  assert.equal(K.normalizeKanjiReading("きっ", { on: ["セツ"], kun: ["き.る"] }, kanjiVariants), "き"); // 切手
  assert.equal(K.normalizeKanjiReading("にい", { on: ["ケイ"], kun: ["あに"] }, kanjiVariants), null); // お兄さん
  assert.equal(K.normalizeKanjiReading("っ赤まっか", { on: ["シン"], kun: ["ま"] }, kanjiVariants), null);
});

test("relevantReadings: las que usan al menos minWords palabras, y siempre la más usada", () => {
  const na = [["めい", 21, 14], ["な", 12, 11], ["みょう", 2, 1], ["rara", 1, 0]];
  assert.deepEqual(K.relevantReadings(na, config), ["めい", "な", "みょう"]);
  assert.deepEqual(K.relevantReadings(na, { relevantMinWords: 3 }), ["めい", "な"]);
  assert.deepEqual(K.relevantReadings([["いち", 1, 1]], config), ["いち"]);
  assert.deepEqual(K.relevantReadings(undefined, config), []);
});

test("wordKanjiReadings: la corrección manda; si no, las etiquetas de un solo kanji", () => {
  assert.deepEqual(K.wordKanjiReadings(["上|しょう", "手|ず"], "上じょう,手ず"), [["上", "じょう"], ["手", "ず"]]);
  assert.deepEqual(K.wordKanjiReadings(["兄|にい"], ""), []);
  assert.deepEqual(K.wordKanjiReadings(["今日|きょう"]), []);
  assert.deepEqual(K.wordKanjiReadings(["学|がく", "校|こう"]), [["学", "がく"], ["校", "こう"]]);
});

test("wordSounds: lo que suena cada parte, aunque la etiqueta sea la lectura de diccionario", () => {
  const info = { 上: { on: ["ジョウ", "ショウ"], kun: ["うえ"] }, 手: { on: ["シュ"], kun: ["て"] },
    学: { on: ["ガク"], kun: ["まな.ぶ"] }, 校: { on: ["コウ"], kun: [] }, 時: { on: ["ジ"], kun: ["とき"] },
    置: { on: ["チ"], kun: ["お.く"] }, 前: { on: ["ゼン"], kun: ["まえ"] } };
  const variants = (c) => kanjiVariants(info[c]);
  assert.deepEqual(K.wordSounds("学校", "がっこう", ["学|がく", "校|こう"], variants),
    [["学", "がっ", "学|がく"], ["校", "こう", "校|こう"]]);
  assert.deepEqual(K.wordSounds("前置き", "まえおき", ["前|まえ", "置|お"], variants),
    [["前", "まえ", "前|まえ"], ["置", "お", "置|お"], ["き", "き", null]]);
  assert.deepEqual(K.wordSounds("時々", "ときどき", ["時|とき", "時|とき"], variants).map(([, sound]) => sound), ["とき", "どき"]);
  assert.deepEqual(K.wordSounds("今日", "きょう", ["今日|きょう"], variants), [["今日", "きょう", "今日|きょう"]]);
  assert.equal(K.wordSounds("学校", "がくせい", ["学|がく", "校|こう"], variants), null);
});

/* Banco de prueba: 名 (めい, な), 前 (まえ, ぜん), 有 (ゆう) */
const kanji = new Map([
  ["名", { readings: [["めい", 21, 14], ["な", 12, 11]] }],
  ["前", { readings: [["まえ", 11, 8], ["ぜん", 10, 7]] }],
  ["有", { readings: [["ゆう", 9, 6]] }]
]);
const words = {
  名前: { id: "名前|なまえ", readings: [["名", "な"], ["前", "まえ"]] },
  有名: { id: "有名|ゆうめい", readings: [["有", "ゆう"], ["名", "めい"]] },
  午前: { id: "午前|ごぜん", readings: [["午", "ご"], ["前", "ぜん"]] }
};

test("kanjiStates: con 名前, 名 y 前 son parciales y dicen qué lectura les falta", () => {
  const states = K.kanjiStates({ kanji, knownWords: [words.名前], meaningKnown: () => true, config });
  assert.deepEqual(states.get("名"), { state: "partial", meaning: true, known: ["な"], missing: ["めい"], words: ["名前|なまえ"] });
  assert.equal(states.get("前").state, "partial");
  assert.deepEqual(states.get("前").missing, ["ぜん"]);
  assert.equal(states.get("有").state, "unknown");
});

test("kanjiStates: dominado con todas sus lecturas y el significado; sin significado, parcial", () => {
  const knownWords = [words.名前, words.有名, words.午前];
  const all = K.kanjiStates({ kanji, knownWords, meaningKnown: () => true, config });
  assert.equal(all.get("名").state, "mastered");
  assert.equal(all.get("前").state, "mastered");
  assert.equal(all.get("有").state, "mastered");
  // 午 no está en la información de kanjis: sale igual, con su única lectura vista
  assert.equal(all.get("午").state, "mastered");
  const noMeaning = K.kanjiStates({ kanji, knownWords, meaningKnown: (c) => c !== "有", config });
  assert.equal(noMeaning.get("有").state, "partial");
  assert.deepEqual(noMeaning.get("有").missing, []);
  assert.equal(noMeaning.get("有").meaning, false);
});

test("kanjiGroups: por nivel, grado o importancia, con «other» y la cuenta por estado", () => {
  const list = [
    { c: "名", level: "N5", grade: 1, importance: 35 }, { c: "有", level: "N4", grade: 3, importance: 120 },
    { c: "前", level: "N5", grade: 2, importance: 20 }, { c: "鬱", level: null, grade: 0, importance: 0, freq: 2400 }
  ];
  const state = { 名: "partial", 前: "mastered", 有: "unknown", 鬱: "unknown" };
  const jlpt = K.kanjiGroups(list, "jlpt", (c) => state[c]);
  assert.deepEqual(jlpt.map((group) => group.key), ["N5", "N4", "other"]);
  assert.deepEqual(jlpt[0].kanji, ["前", "名"]); // los más importantes primero
  assert.deepEqual(jlpt[0].counts, { mastered: 1, partial: 1, unknown: 0, total: 2 });
  assert.deepEqual(K.kanjiGroups(list, "grade", (c) => state[c]).map((group) => group.key), ["grade1", "grade2", "grade3", "other"]);
  assert.deepEqual(K.kanjiGroups(list, "frequency", (c) => state[c]).map((group) => group.key), ["top100", "top250", "other"]);
});
