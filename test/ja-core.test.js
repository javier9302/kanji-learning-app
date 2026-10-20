/* Fija el análisis de unidades que hacía reading.js antes de moverlo a ja-core.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyseUnits, unitOf, isKana, splitSentences, segmentSentence } = require("../ja-core.js");
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

test("splitSentences: 。！？, comillas de cierre y párrafos", () => {
  const texts = (input) => splitSentences(input).map((part) => part.text);
  assert.deepEqual(texts("私は毎朝コーヒーを飲みます。今日は雨です！本当？"),
    ["私は毎朝コーヒーを飲みます。", "今日は雨です！", "本当？"]);
  // Dentro de unas comillas no se corta; la cita con su punto sigue hasta el final de la oración
  assert.deepEqual(texts("「行きます。」と言った。それから帰った。"), ["「行きます。」と言った。", "それから帰った。"]);
  // Dos citas seguidas son dos oraciones
  assert.deepEqual(texts("「おはよう。」「元気ですか。」"), ["「おはよう。」", "「元気ですか。」"]);
  assert.deepEqual(texts("え！？本当ですか。"), ["え！？", "本当ですか。"]);
  assert.deepEqual(texts("最後に点がない"), ["最後に点がない"]);
  assert.deepEqual(texts("  \n\n "), []);
  // Cada línea es un párrafo
  assert.deepEqual(splitSentences("題\n一つ目。二つ目。\n\n三つ目。").map((part) => part.p), [1, 2, 2, 3]);
});

test("segmentSentence: las mismas unidades que se le piden a la IA", async () => {
  const tokenizer = await loadTokenizer();
  const seg = (text) => segmentSentence(tokenizer, text);
  assert.equal(seg("私は毎朝コーヒーを飲みます。"), "私|は|毎朝|コーヒー|を|飲みます|。");
  assert.equal(seg("あまりおいしくなかったです。"), "あまり|おいしくなかった|です|。");
  assert.equal(seg("図書館で勉強しています。"), "図書館|で|勉強|しています|。");
  assert.equal(seg("昨日は何も食べませんでした。"), "昨日|は|何|も|食べませんでした|。");
  assert.equal(seg("とても静かでした。"), "とても|静か|でした|。");
  assert.equal(seg("お茶を三杯飲んでしまいました。"), "お茶|を|三杯|飲んでしまいました|。");
  // Nada se pierde ni se añade, tampoco con espacios o con una barra en el texto
  for (const text of ["「明日も一緒に行きませんか」と友達に聞かれました。", "東京 に 行った。", "A|Bです。"]) {
    assert.equal(seg(text).split("|").join(""), text.replace(/\s/g, "").replace(/\|/g, "｜"));
    assert.ok(!seg(text).split("|").includes(""));
  }
});

test("palabras en kana: la que se escribe en kana, o la única que se lee así; nunca la primera que coincide", () => {
  const { kanaFormWord, onlyHomophone } = require("../ja-core.js");
  const 有る = { w: "有る", kana: true }, 在る = { w: "在る", kana: true }, 要る = { w: "要る", kana: false }, 炒る = { w: "炒る", kana: false };
  assert.equal(kanaFormWord([要る, 有る, 在る]), 有る);
  assert.equal(kanaFormWord([要る, 炒る]), null);          // いる: ninguna se escribe en kana -> que decida el diccionario
  assert.equal(kanaFormWord(undefined), null);
  assert.equal(onlyHomophone([要る]), 要る);                // いう -> 言う: solo hay una
  assert.equal(onlyHomophone([要る, 炒る]), null);          // varias: no se adivina
  assert.equal(onlyHomophone([]), null);
});
