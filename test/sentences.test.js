const test = require("node:test");
const assert = require("node:assert/strict");
const { readingMatches, resolveKey, validateSentence } = require("../sentences-core.js");
const { sentenceFrom, wordOf } = require("../tools/lib/analyse.js");
const { loadBank } = require("../tools/lib/bank.js");

const make = (ja, extra = {}) => sentenceFrom({ id: "x", ja, source: "ai", en: "en", es: "es", ...extra });
const check = (sentence, options) => validateSentence(sentence, { wordOf, ...options });

test("readingMatches compara la parte con kanji, también conjugada", () => {
  const tok = (surface, reading) => ({ surface, reading });
  assert.ok(readingMatches(tok("学校", "がっこう"), "学校", "がっこう"));
  assert.ok(readingMatches(tok("学校", "ガッコウ"), "学校", "がっこう"));
  assert.ok(!readingMatches(tok("今日", "こんにち"), "今日", "きょう"));
  assert.ok(readingMatches(tok("行った", "いった"), "行く", "いく"));
  assert.ok(!readingMatches(tok("行った", "おこなった"), "行く", "いく"));
  assert.ok(!readingMatches(tok("行った", "いった"), "行う", "おこなう"));
  assert.ok(readingMatches(tok("食べました", "たべました"), "食べる", "たべる"));
  assert.ok(readingMatches(tok("高くない", "たかくない"), "高い", "たかい"));
  assert.ok(readingMatches(tok("来ます", "きます"), "来る", "くる"));
  assert.ok(readingMatches(tok("来ない", "こない"), "来る", "くる"));
  assert.ok(!readingMatches(tok("生", "なま"), "生", "せい"));
  assert.ok(!readingMatches(tok("学校", ""), "学校", "がっこう")); // kuromoji no supo leerla
});

test("resolveKey elige el homógrafo que se lee como en la frase", () => {
  const BANK = loadBank();
  const sensesOf = (form) => BANK.byWriting.get(form);
  assert.equal(resolveKey({ surface: "角", lemma: "角", reading: "かど" }, sensesOf), "角|かど");
  assert.equal(resolveKey({ surface: "角", lemma: "角", reading: "つの" }, sensesOf), "角|つの");
  assert.equal(resolveKey({ surface: "角", lemma: "角", reading: "ぞ" }, sensesOf, "otra"), "otra");
  assert.equal(resolveKey({ surface: "飲みます", lemma: "飲む", reading: "のみます" }, sensesOf), "飲む|のむ");
});

test("buildSentence: unidades, targets, nivel y lecturas de kanji", async () => {
  const sentence = await make("私|は|毎朝|学校|に|行きます|。");
  assert.equal(sentence.ja, "私|は|毎朝|学校|に|行きます|。");
  assert.deepEqual(Object.keys(sentence.tokens[0]), ["surface", "lemma", "reading", "pos", "key"]);
  assert.ok(sentence.targets.includes("学校|がっこう"));
  assert.ok(sentence.targets.includes("行く|いく"));
  assert.ok(sentence.kanjiReadings.includes("学|がく") && sentence.kanjiReadings.includes("校|こう"));
  assert.equal(sentence.level, "N5");
  assert.ok(!sentence.targets.some((id) => id.startsWith("は|"))); // las partículas no se preguntan
});

test("el nivel de la frase es el de su palabra más difícil", async () => {
  const sentence = await make("経済|の|本|を|読みます|。");
  assert.equal(sentence.level, loadBank().words.get("経済|けいざい").level);
  assert.notEqual(sentence.level, "N5");
});

test("validateSentence acepta una frase buena para su palabra", async () => {
  const sentence = await make("私|は|毎朝|学校|に|行きます|。");
  assert.deepEqual(check(sentence, { targets: ["学校|がっこう"], maxLevel: "N5" }), { ok: true, reasons: [] });
  assert.deepEqual(check(sentence, { text: "私は毎朝学校に行きます。", targets: ["学校|がっこう"] }).reasons, []);
});

test("validateSentence: cada motivo de rechazo", async () => {
  const reasons = async (ja, options, extra) => check(await make(ja, extra), options).reasons;
  // las unidades no reproducen la frase
  assert.deepEqual(await reasons("私|は|毎朝|学校|に|行きます|。", { text: "私は毎日学校に行きます。", targets: ["学校|がっこう"] }), ["units_mismatch"]);
  // longitud
  assert.deepEqual(await reasons("学校|に|行きます|。", { targets: ["学校|がっこう"] }), ["length"]);
  // la palabra pedida no está
  assert.deepEqual(await reasons("私|は|毎朝|学校|に|行きます|。", { targets: ["病院|びょういん"] }), ["target_missing"]);
  // está, pero kuromoji la lee de otra forma (今日 -> きょう; se pide こんにち)
  assert.ok((await reasons("今日|は|学校|に|行きません|でした|。", { targets: ["今日|こんにち"] })).includes("reading_mismatch"));
  // 行った leído いった no sirve para 行う
  assert.ok((await reasons("昨日|友達|と|学校|に|行った|。", { targets: ["行う|おこなう"] })).some((r) => /target_missing|reading_mismatch/.test(r)));
  // vocabulario por encima del nivel
  assert.deepEqual(await reasons("経済|の|本|を|毎日|読みます|。", { targets: ["本|ほん"], maxLevel: "N5" }), ["level"]);
  // letras latinas y paréntesis
  assert.ok((await reasons("私|は|毎朝|TV|を|見ます|。", { targets: ["見る|みる"], allowUnresolved: true })).includes("latin"));
  assert.ok((await reasons("角|(|かど|)|を|右|に|曲がります|。", { targets: ["右|みぎ"], allowUnresolved: true })).includes("brackets"));
  assert.ok((await reasons("「|学校|に|毎朝|行きます|と|言いました|。", { targets: ["学校|がっこう"] })).includes("brackets"));
});

test("validateSentence detecta duplicadas y casi iguales (solo cambia la puntuación)", async () => {
  const seen = new Set();
  const options = { targets: ["学校|がっこう"], seen };
  assert.ok(check(await make("私|は|毎朝|学校|に|行きます|。"), options).ok);
  assert.deepEqual(check(await make("私|は|毎朝|学校|に|行きます|！"), options).reasons, ["duplicate"]);
  assert.ok(check(await make("私|は|毎晩|学校|に|行きます|。"), options).ok);
  // Una rechazada por otro motivo no ocupa sitio
  const other = new Set();
  check(await make("学校|に|行きます|。"), { targets: ["学校|がっこう"], seen: other });
  assert.equal(other.size, 0);
});

test("validateSentence para los textos del usuario: 4-20 unidades y todo resuelto", async () => {
  const sentence = await make("私|は|毎朝|学校|に|行きます|。", { source: "text" });
  assert.ok(check(sentence, { minUnits: 4, maxUnits: 20 }).ok);
  // Sin ninguna palabra que preguntar no sirve
  assert.deepEqual(check(await make("これ|は|とても|おいしい|です|。", { source: "text" }), { minUnits: 4, maxUnits: 20 }).reasons, ["no_target"]);
});
