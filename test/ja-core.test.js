/* Fija el análisis de unidades que hacía reading.js antes de moverlo a ja-core.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyseUnits, unitOf, isKana } = require("../ja-core.js");
const { loadTokenizer } = require("../tools/lib/tokenizer.js");

const brief = (units) => units.map((u) => [u.surface, u.basic, u.reading, u.pos]);

test("una oración sencilla: lema, lectura y tipo de cada unidad", async () => {
  const tokenizer = await loadTokenizer();
  assert.deepEqual(brief(analyseUnits(tokenizer, "私|は|毎朝|コーヒー|を|飲みます|。")), [
    ["私", "私", "わたし", "pronoun"],
    ["は", "は", "は", "particle"],
    ["毎朝", "毎朝", "まいあさ", "noun"],
    ["コーヒー", "コーヒー", "コーヒー", "noun"],
    ["を", "を", "を", "particle"],
    ["飲みます", "飲む", "のみます", "verb"],
    ["。", "。", "。", "punctuation"]
  ]);
});

test("un verbo conjugado es una unidad con el lema del verbo", async () => {
  const tokenizer = await loadTokenizer();
  const units = analyseUnits(tokenizer, "友達|に|聞かれました|。");
  assert.equal(units[2].basic, "聞く");
  assert.equal(units[2].reading, "きかれました");
  assert.equal(units[2].pos, "verb");
  assert.equal(units[2].morph.length, units[2].pieces.length);
});

test("una unidad que kuromoji no separa igual se analiza sola", async () => {
  const tokenizer = await loadTokenizer();
  // kuromoji lee 食事中 como 食事 + 中: la unidad conserva su escritura entera
  const units = analyseUnits(tokenizer, "食事中|です|。");
  assert.equal(units[0].surface, "食事中");
  assert.equal(units.map((u) => u.surface).join(""), "食事中です。");
});

test("los espacios alrededor de una unidad se ignoran", async () => {
  const tokenizer = await loadTokenizer();
  assert.deepEqual(analyseUnits(tokenizer, "本 | を |読む").map((u) => u.surface), ["本", "を", "読む"]);
});

test("unitOf: puntuación y katakana", async () => {
  const tokenizer = await loadTokenizer();
  assert.equal(unitOf(tokenizer.tokenize("、")).pos, "punctuation");
  assert.equal(unitOf(tokenizer.tokenize("テレビ")).reading, "テレビ");
  assert.ok(isKana("ひらがなカタカナー"));
  assert.ok(!isKana("漢字"));
});
