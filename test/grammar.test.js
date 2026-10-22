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
  const row = grammarBreakdown(states).N5;
  assert.deepEqual(row, { mastered: 1, understood: 1, seen: 1, unseen: GRAMMAR.length - 3, total: GRAMMAR.length });
  assert.equal(grammarShare(row), 2 / GRAMMAR.length);
});
