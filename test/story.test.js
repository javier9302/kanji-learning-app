const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../story-core.js");

const config = { max: 8, soonDays: 2 };
const day = "2026-10-27";

test("storyTargets: primero lo que toca (lo más atrasado antes), luego lo de pronto y los kanjis", () => {
  const words = [
    { id: "b|", label: "B", studied: true, nextReview: "2026-10-27" },
    { id: "a|", label: "A", studied: true, nextReview: "2026-10-20" },
    { id: "c|", label: "C", studied: true, nextReview: "2026-10-29" },  // dentro de 2 días
    { id: "d|", label: "D", studied: true, nextReview: "2026-11-05" },  // más tarde: no
    { id: "e|", label: "E", studied: false, nextReview: "2026-10-20" }  // sin estudiar: no
  ];
  const kanji = [{ c: "名", nextReview: "2026-10-25", word: { id: "名前|なまえ", label: "名前" } },
    { c: "前", nextReview: "2026-10-25", word: { id: "a|", label: "A" } },    // ya está como palabra
    { c: "有", nextReview: "2026-11-01", word: { id: "有名|ゆうめい", label: "有名" } }]; // aún no toca
  assert.deepEqual(S.storyTargets(words, kanji, day, config).map((x) => [x.label, x.due]),
    [["A", true], ["B", true], ["C", false], ["名前", true]]);
  assert.equal(S.storyTargets(words, kanji, day, { max: 2, soonDays: 2 }).length, 2);
});

test("targetsFound: las pedidas que salen de verdad en el texto", () => {
  const targets = [{ id: "名前|なまえ" }, { id: "有名|ゆうめい" }];
  assert.deepEqual(S.targetsFound(targets, { "名前|なまえ": 2, "私|わたし": 1 }), ["名前|なまえ"]);
});

test("nextVariety: el tipo y el tema que hace más que no salen, y los personajes menos usados", () => {
  const types = ["story", "dialogue", "diary"], topics = ["food", "work", "travel"];
  assert.deepEqual(S.nextVariety([], types, topics, 4), { type: "story", topic: "food", cast: [0, 1] });
  const history = [
    { type: "story", topic: "food", cast: [0, 1] },
    { type: "dialogue", topic: "work", cast: [0, 2] }
  ];
  // 0 y 1 salieron en el último texto; 2, en el anterior; 3, nunca
  assert.deepEqual(S.nextVariety(history, types, topics, 4), { type: "diary", topic: "travel", cast: [2, 3] });
  // Todos usados: el más antiguo
  assert.equal(S.nextVariety([{ type: "diary" }, { type: "story" }, { type: "dialogue" }], types, topics, 4).type, "dialogue");
});

test("textSimilarity: frases repetidas, no palabras sueltas", () => {
  const cfg = { sentenceMatch: 0.7, maxShare: 0.25, maxRepeated: 3 };
  const recent = ["お腹が空きました。", "私は公園に行きました。", "友達と一緒に遊びました。"];
  const fresh = ["今日は図書館で本を読みました。", "駅の前で先生に会いました。", "雨が降っていました。", "はい。"];
  assert.deepEqual(S.textSimilarity(fresh, recent, cfg), { repeated: [], share: 0, tooSimilar: false });
  const same = ["お腹が空きました！", "私は|公園に|行きました。", "新しい靴を買いました。", "母に電話しました。"];
  const result = S.textSimilarity(same, recent, cfg);
  assert.deepEqual(result.repeated, ["お腹が空きました！", "私は|公園に|行きました。"]);
  assert.equal(result.share, 0.5);
  assert.equal(result.tooSimilar, true);
});
