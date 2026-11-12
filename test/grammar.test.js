const test = require("node:test");
const assert = require("node:assert/strict");
const { GRAMMAR, detectGrammar, grammarStates, grammarBreakdown, grammarShare } = require("../grammar-core.js");
const { loadTokenizer } = require("../tools/lib/tokenizer.js");

const detect = async (text) => detectGrammar((await loadTokenizer()).tokenize(text));

test("el ejemplo de cada estructura la detecta", async () => {
  const missed = [];
  for (const point of GRAMMAR) {
    if (!(await detect(point.example)).includes(point.id)) missed.push(`${point.id}: ${point.example}`);
  }
  assert.deepEqual(missed, []);
});

test("los ids no se repiten y cada estructura tiene nivel, nombres y ejemplo", () => {
  assert.equal(new Set(GRAMMAR.map((point) => point.id)).size, GRAMMAR.length);
  for (const point of GRAMMAR) assert.ok(point.level && point.ja && point.es && point.en && point.example, point.id);
});

test("no confunde estructuras parecidas", async () => {
  const has = async (text, id) => (await detect(text)).includes(id);
  // Pasado cortés no es pasado llano; ませんでした no es solo ません
  assert.ok(!(await has("食べました。", "ta")));
  assert.ok(!(await has("行きませんでした。", "masen")) && await has("行きませんでした。", "masen-deshita"));
  assert.ok(!(await has("行きませんでした。", "deshita")));
  // から: "porque" frente a "desde", y てから
  assert.ok(await has("高いから買いません。", "kara") && !(await has("高いから買いません。", "kara-made")));
  assert.ok(await has("駅から歩きます。", "kara-made") && !(await has("駅から歩きます。", "kara")));
  assert.ok(!(await has("食べてから寝ます。", "kara-made")));
  // が: sujeto frente a "pero"
  assert.ok(await has("猫がいます。", "ga") && !(await has("猫がいます。", "ga-but")));
  // ましょう frente a ましょうか, ません frente a ませんか
  assert.ok(!(await has("開けましょうか。", "mashou")));
  assert.ok(await has("行きませんか。", "masen-ka"));
  // か en mitad de la frase no es pregunta
  assert.ok(!(await has("何か食べます。", "ka")));
  // 三時 (la hora) no es 〜とき
  assert.ok(!(await has("三時に起きた。", "toki")));
  // くない es la negación del adjetivo, no la del verbo
  assert.ok(await has("高くない。", "i-adj-neg") && !(await has("高くない。", "nai")));
});

test("una frase con varias estructuras las da todas, en el orden del catálogo", async () => {
  assert.deepEqual(await detect("本を読んでいます。"), ["wo", "masu", "te", "te-iru"]);
});

const ev = (kind, ids, day, at) => ({ kind, ids, day, at });

test("grammarStates: vista, entendida (traducción o lecturas limpias) y dominada (días distintos)", () => {
  const states = grammarStates([
    ev("seen", ["wa"], "2026-10-01", 1),
    ev("good", ["ga"], "2026-10-01", 2),
    ev("clean", ["wo"], "2026-10-01", 3), ev("clean", ["wo"], "2026-10-02", 4), ev("clean", ["wo"], "2026-10-03", 5),
    ev("good", ["ni"], "2026-10-01", 6), ev("good", ["ni"], "2026-10-02", 7),
    ev("good", ["de"], "2026-10-01", 8), ev("good", ["de"], "2026-10-02", 9), ev("bad", ["de"], "2026-10-03", 10),
    ev("good", ["he"], "2026-10-01", 11), ev("good", ["he"], "2026-10-01", 12)  // el mismo día: no basta
  ]);
  assert.equal(states.get("wa"), "seen");
  assert.equal(states.get("ga"), "understood");
  assert.equal(states.get("wo"), "understood");
  assert.equal(states.get("ni"), "mastered");
  assert.equal(states.get("de"), "seen");        // su última traducción fue mala
  assert.equal(states.get("he"), "understood");
  assert.equal(states.get("to"), "unseen");
  assert.equal(states.size, GRAMMAR.length);
});

test("grammarBreakdown y grammarShare: recuento por nivel y lo que se maneja", () => {
  const states = grammarStates([ev("good", ["wa"], "d1", 1), ev("good", ["wa"], "d2", 2), ev("good", ["ga"], "d1", 3), ev("seen", ["wo"], "d1", 4)]);
  const n5 = GRAMMAR.filter((point) => point.level === "N5").length;
  const n4 = GRAMMAR.filter((point) => point.level === "N4").length;
  const rows = grammarBreakdown(states);
  assert.deepEqual(rows.N5, { mastered: 1, understood: 1, seen: 1, unseen: n5 - 3, total: n5 });
  assert.deepEqual(rows.N4, { mastered: 0, understood: 0, seen: 0, unseen: n4, total: n4 });
  assert.deepEqual(Object.keys(rows), ["N5", "N4"]);
  assert.equal(grammarShare(rows.N5), 2 / n5);
});

test("N4: hay catálogo y no confunde estructuras parecidas", async () => {
  assert.ok(GRAMMAR.filter((point) => point.level === "N4").length >= 40);
  const has = async (text, id) => (await detect(text)).includes(id);
  // なくてもいい (no hace falta) no es てもいい (permiso), ni なくてはいけない (tener que) es てはいけない
  assert.ok(await has("行かなくてもいいです。", "nakute-mo-ii") && !(await has("行かなくてもいいです。", "te-mo-ii")));
  assert.ok(await has("食べてもいいです。", "te-mo-ii") && !(await has("食べてもいいです。", "nakute-mo-ii")));
  assert.ok(await has("行かなくてはいけない。", "nakereba") && !(await has("行かなくてはいけない。", "te-wa-ikenai")));
  // ても (aunque) no es てもいい
  assert.ok(await has("寒くても行きます。", "temo") && !(await has("食べてもいいです。", "temo")));
  // なければ es «tener que», no un condicional ば más
  assert.ok(!(await has("勉強しなければなりません。", "ba")));
  // ないでください es N5; ないで a secas, «sin»
  assert.ok(await has("傘を持たないで出かけた。", "naide") && !(await has("見ないでください。", "naide")));
  // causativa, pasiva y causativa pasiva por separado
  assert.ok(await has("母に野菜を食べさせました。", "saseru") && !(await has("母に野菜を食べさせました。", "rareru")));
  assert.ok(await has("野菜を食べさせられた。", "saserareru") && !(await has("野菜を食べさせられた。", "saseru")) && !(await has("野菜を食べさせられた。", "rareru")));
  // そう: «parece» frente a «dicen que»
  assert.ok(await has("雨が降りそうです。", "sou-looks") && !(await has("雨が降りそうです。", "sou-hearsay")));
  assert.ok(await has("雨が降るそうです。", "sou-hearsay") && !(await has("雨が降るそうです。", "sou-looks")));
  // ように (para que) frente a ようになる (llegar a), y ようだ (parece)
  assert.ok(await has("日本語が話せるようになりました。", "you-ni-naru") && !(await has("日本語が話せるようになりました。", "you-ni")));
  assert.ok(await has("忘れないようにメモします。", "you-ni") && !(await has("忘れないようにメモします。", "you-da")));
  // ほうがいい (consejo) no es la comparación より〜のほうが
  assert.ok(!(await has("犬より猫のほうが好きです。", "hou-ga-ii")));
  assert.ok(await has("行かないほうがいい。", "hou-ga-ii") && await has("読んだほうがいいです。", "hou-ga-ii"));
  // ようと思う no es también と思う; と思う de un nombre (友達と) no es citar
  assert.ok(await has("暑いと思います。", "to-omou") && !(await has("毎日運動しようと思います。", "to-omou")));
  assert.ok(!(await has("友達と話します。", "to-omou")));
  // ましょう (N5) no es la volitiva llana
  assert.ok(!(await has("行きましょう。", "volitional")));
  // la と condicional no es la と de «con»
  assert.ok(await has("春になると暖かくなります。", "to-cond") && !(await has("友達と行きます。", "to-cond")));
  // しか sin negación no es しか〜ない
  assert.ok(await has("百円しかない。", "shika-nai") && await has("少ししか食べません。", "shika-nai"));
  // てくれる es un favor; くれる a secas, dar
  assert.ok(await has("来てくれる？", "te-morau") && !(await has("来てくれる？", "ageru-kureru")));
  assert.ok(await has("友達が本をくれました。", "ageru-kureru") && !(await has("友達が本をくれました。", "te-morau")));
});

test("N4: のには (el hecho de) no es のに", async () => {
  assert.ok(!(await detect("遅くまで起きているのには慣れています。")).includes("noni"));
  assert.ok((await detect("雨が降っているのに出かけた。")).includes("noni"));
});
