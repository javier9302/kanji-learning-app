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

/* ---------- 4. Listas limpias para la IA ---------- */

// kuromoji de mentira con lo justo para estas pruebas
const TOKENS = {
  いました: [["い", "動詞", "自立", "いる"], ["まし", "助動詞", "*", "ます"], ["た", "助動詞", "*", "た"]],
  来て: [["来", "動詞", "自立", "来る"], ["て", "助詞", "接続助詞", "て"]],
  有名な: [["有名", "名詞", "形容動詞語幹", "有名"], ["な", "助動詞", "*", "だ"]],
  のは: [["の", "名詞", "非自立", "の"], ["は", "助詞", "係助詞", "は"]],
  こと: [["こと", "名詞", "非自立", "こと"]],
  聞こえ: [["聞こえ", "動詞", "自立", "聞こえる"]],
  たち: [["たち", "動詞", "自立", "たつ"]],
  ける: [["ける", "動詞", "自立", "ける"]],
  日本人: [["日本人", "名詞", "一般", "日本人"]]
};
const tools = {
  tokens: (text) => (TOKENS[text] || [[text, "名詞", "一般", text]]).map(([surface, pos, detail, base]) => ({ surface, pos, detail, base })),
  inBank: (lemma) => ["嫌い", "来る", "有名", "下手", "落す"].includes(lemma),
  hasMeaning: (lemma, reading) => !(lemma === "下手" && reading === "したて"),
  label: (lemma) => lemma === "有る" ? "ある" : lemma
};

test("promptWord: las conjugadas vuelven a su forma de diccionario y los trozos no van", () => {
  const { promptWord } = require("../story-core.js");
  assert.equal(promptWord({ lemma: "いました" }, tools).label, "いる");
  assert.equal(promptWord({ lemma: "来て" }, tools).label, "来る");
  assert.equal(promptWord({ lemma: "有名な" }, tools).label, "有名");
  assert.equal(promptWord({ lemma: "聞こえ" }, tools).label, "聞こえる");
  assert.equal(promptWord({ lemma: "のは" }, tools).drop, "trozo");
  assert.equal(promptWord({ lemma: "い" }, tools).drop, "kana suelta");
  assert.equal(promptWord({ lemma: "ける", status: "pre_known" }, tools).drop, "trozo probable");
  assert.equal(promptWord({ lemma: "下手", reading: "したて" }, tools).drop, "sin significado");
  // Lo que ya es palabra no se toca: こと sola, たち en kana, 日本人 entera, 嫌い del banco
  assert.equal(promptWord({ lemma: "こと" }, tools).label, "こと");
  assert.equal(promptWord({ lemma: "たち" }, tools).label, "たち");
  assert.equal(promptWord({ lemma: "日本人" }, tools).label, "日本人");
  assert.equal(promptWord({ lemma: "嫌い" }, tools).label, "嫌い");
});

test("promptWord: grafías de hoy (御飯 -> ご飯, 落す -> 落とす, 有る -> ある); sin kuromoji, solo eso", () => {
  const { promptWord } = require("../story-core.js");
  assert.equal(promptWord({ lemma: "朝御飯" }, tools).label, "朝ご飯");
  assert.equal(promptWord({ lemma: "綺麗" }, tools).label, "きれい");
  assert.equal(promptWord({ lemma: "落す", reading: "おとす" }, tools).label, "落とす");
  assert.equal(promptWord({ lemma: "有る" }, tools).label, "ある");
  // La Edge Function no tiene kuromoji ni banco: recibe textos y solo aplica lo que no los necesita
  assert.equal(promptWord("いました").label, "いました");
  assert.equal(promptWord("御飯").label, "ご飯");
  assert.equal(promptWord("い").drop, "kana suelta");
});

test("cleanWordLists: cada palabra en una sola lista (repasar > aprendiendo > conocida) y sin repetirse", () => {
  const { cleanWordLists } = require("../story-core.js");
  const out = cleanWordLists({
    targets: [{ id: "下手|したて", lemma: "下手", reading: "したて" }, { id: "試合|しあい", lemma: "試合" }],
    learning: [{ lemma: "試合" }, { lemma: "来て" }, { lemma: "会社" }],
    known: [{ lemma: "会社" }, { lemma: "来る" }, { lemma: "一番" }, { lemma: "来て" }]
  }, tools);
  assert.deepEqual(out.targets, [{ id: "試合|しあい", label: "試合" }]);
  assert.deepEqual(out.learning, ["来る", "会社"]);
  assert.deepEqual(out.known, ["一番"]);
  assert.deepEqual(out.removed, [{ list: "targets", word: "下手", reason: "sin significado" }]);
  assert.deepEqual(out.changed, [{ list: "learning", from: "来て", to: "来る" }]);
});

/* ---------- 5. Escenas gastadas ---------- */

test("overusedScenes: lo que sale en 3 o más de los últimos textos, los descartados no cuentan", () => {
  const { overusedScenes } = require("../story-core.js");
  const lemmas = {
    a: { "公園|こうえん": 2, "猫|ねこ": 1, "私|わたし": 3 }, b: { "公園|こうえん": 1, "猫|ねこ": 1 },
    c: { "公園|こうえん": 1, "猫|ねこ": 2, "ある|ある": 1 }, d: { "公園|こうえん": 1, "駅|えき": 1 }, e: { "駅|えき": 1 }
  };
  const sessions = [
    { textId: "a", finishedAt: 5 }, { textId: "b", finishedAt: 4 }, { textId: "c", finishedAt: 3 },
    { textId: "d", finishedAt: 2, discarded: true }, { textId: "e", finishedAt: 1 }, { textId: "a", finishedAt: 0 }
  ];
  const skip = (key) => key === "私|わたし"; // común: no es una escena
  assert.deepEqual(overusedScenes(sessions, (id) => lemmas[id], { recent: 10, minTexts: 3, max: 8 }, skip), ["公園", "猫"]);
  // Solo los últimos: con 2 textos ya nada llega a 3
  assert.deepEqual(overusedScenes(sessions, (id) => lemmas[id], { recent: 2, minTexts: 3, max: 8 }, skip), []);
});

/* ---------- 6. Palabras guardadas al leer ---------- */

const { loadTokenizer } = require("../tools/lib/tokenizer.js");
const { loadBank } = require("../tools/lib/bank.js");

/* Con el banco y kuromoji de verdad; el diccionario general, solo las filas que hacen falta */
async function wordTools(records = [], entries = null) {
  const jmdict = new Map([
    ["いる", { reading: "いる", meanings: ["to be"], meanings_es: [], uk: true }],
    ["喜んで", { reading: "よろこんで", meanings: ["with pleasure"], meanings_es: [], uk: false }]
  ]);
  return S.savedWordTools({ bank: loadBank(), jmdict, entries, records: new Map(records.map((rec) => [rec.id, rec])),
    tokenizer: await loadTokenizer() });
}
const form = (result) => result.drop ? `drop: ${result.drop}` : result.id;

test("savedWord: se guarda el lema de kuromoji (来ました -> 来る, 喜んで -> 喜ぶ, 有名な -> 有名)", async () => {
  const tools = await wordTools();
  assert.equal(form(S.savedWord({ lemma: "来ました", reading: "きました" }, tools)), "来る|くる");
  assert.equal(form(S.savedWord({ lemma: "喜んで", reading: "よろこんで" }, tools)), "喜ぶ|よろこぶ");
  assert.equal(form(S.savedWord({ lemma: "有名な", reading: "ゆうめいな" }, tools)), "有名|ゆうめい");
  assert.equal(form(S.savedWord({ lemma: "聞こえ", reading: "きこえ" }, tools)), "聞こえる|きこえる");
  assert.equal(form(S.savedWord({ lemma: "いました", reading: "いました" }, tools)), "いる|いる");
  // Lo que ya es palabra no cambia: del banco (一緒に, 来 らい), saludos y partículas que forman adverbio
  assert.equal(form(S.savedWord({ lemma: "来", reading: "らい" }, tools)), "来|らい");
  assert.equal(form(S.savedWord({ lemma: "ありがとうございます", reading: "ありがとうございます" }, tools)), "ありがとうございます|ありがとうございます");
  assert.equal(form(S.savedWord({ lemma: "すぐに", reading: "すぐに" }, tools)), "すぐに|すぐに");
  assert.equal(form(S.savedWord({ lemma: "日本人", reading: "にほんじん" }, tools)), "日本人|にほんじん");
});

test("savedWord: partículas, kana sueltas, trozos y lecturas inventadas no se guardan", async () => {
  const tools = await wordTools();
  assert.equal(form(S.savedWord({ lemma: "のは", reading: "のは" }, tools)), "drop: partícula o auxiliar");
  assert.equal(form(S.savedWord({ lemma: "んだ", reading: "んだ" }, tools)), "drop: partícula o auxiliar");
  assert.equal(form(S.savedWord({ lemma: "い", reading: "い" }, tools)), "drop: kana suelta");
  assert.equal(form(S.savedWord({ lemma: "ける", reading: "ける" }, tools)), "drop: trozo probable");
  assert.equal(form(S.savedWord({ lemma: "下手", reading: "したて" }, tools)), "drop: lectura inventada");
  // Dos kana con entrada (いる) o que ya repasa no son un trozo
  assert.equal(form(S.savedWord({ lemma: "いる", reading: "いる" }, tools)), "いる|いる");
  assert.equal(form(S.savedWord({ lemma: "みる", reading: "みる", studied: true, repetitions: 3 }, tools)), "みる|みる");
});

test("savedWord: en kana si casi siempre va así, grafías de hoy y significado vacío", async () => {
  const tools = await wordTools([], new Map([["もうすぐ|もうすぐ", { meanings: [], meaningsEs: [] }]]));
  assert.equal(form(S.savedWord({ lemma: "有る", reading: "ある" }, tools)), "ある|ある");
  assert.equal(form(S.savedWord({ lemma: "朝御飯", reading: "あさごはん" }, tools)), "朝ご飯|あさごはん");
  assert.equal(form(S.savedWord({ lemma: "落す", reading: "おとす" }, tools)), "落とす|おとす");
  assert.equal(form(S.savedWord({ lemma: "もうすぐ", reading: "もうすぐ" }, tools)), "drop: sin significado");
  // Sin ficha en este dispositivo (llegó por sincronización) no se sabe: se queda; con su significado, también
  assert.equal(form(S.savedWord({ lemma: "どうする", reading: "どうする" }, tools)), "どうする|どうする");
  assert.equal(form(S.savedWord({ lemma: "もうすぐ", reading: "もうすぐ", meaning: "soon" }, tools)), "もうすぐ|もうすぐ");
});

test("savedWord: un verbo en kana va con la escritura que ya tiene (いきました -> 行く)", async () => {
  const tools = await wordTools([{ id: "行く|いく" }]);
  assert.equal(form(S.savedWord({ lemma: "いきました", reading: "いきました" }, tools)), "行く|いく");
  const none = await wordTools();
  assert.equal(form(S.savedWord({ lemma: "いきました", reading: "いきました" }, none)), "いく|いく");
});

test("planWordCleanup: une en el lema con el mejor estado y el repaso del que más repasó", async () => {
  const records = [
    { id: "ある|ある", lemma: "ある", reading: "ある", status: "mastered", repetitions: 0, seen: 17, lookups: 0, firstSeen: 50, lastSeen: 90 },
    { id: "有る|ある", lemma: "有る", reading: "ある", status: "learning", studied: true, repetitions: 4,
      fsrs: { due: "x", reps: 4 }, correctCount: 3, incorrectCount: 1, seen: 9, lookups: 1, firstSeen: 10, lastSeen: 70 },
    { id: "下手|したて", lemma: "下手", reading: "したて", status: "learning", repetitions: 1 },
    { id: "会社|かいしゃ", lemma: "会社", reading: "かいしゃ", status: "learning" }
  ];
  const plan = S.planWordCleanup(records, await wordTools(records), 1000);
  assert.deepEqual(plan.drops.map((drop) => drop.id), ["下手|したて"]);
  assert.deepEqual(plan.moves.map(({ from, to }) => [from, to]), [["有る|ある", "ある|ある"]]);
  assert.deepEqual(plan.remove.sort(), ["下手|したて", "有る|ある"]);
  const [merged] = plan.save;
  assert.deepEqual([merged.id, merged.status, merged.repetitions, merged.fsrs, merged.correctCount, merged.studied],
    ["ある|ある", "mastered", 4, { due: "x", reps: 4 }, 3, true]);
  assert.deepEqual([merged.seen, merged.lookups, merged.firstSeen, merged.lastSeen, merged.updatedAt], [26, 1, 10, 90, 1000]);
  // Lo que no cambia no se vuelve a escribir, y aplicarla otra vez no hace nada
  assert.equal(plan.save.length, 1);
  const after = [merged, records[3]];
  const again = S.planWordCleanup(after, await wordTools(after));
  assert.deepEqual([again.drops.length, again.moves.length, again.save.length], [0, 0, 0]);
});
