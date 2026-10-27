const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseSentence, chooseKanjiSentence, kanjiSounds } = require("../sentences-core.js");
const { loadBank } = require("../tools/lib/bank.js");

/* Frase mínima: unidades [superficie, lema, lectura, tipo, clave] */
const sentence = (id, source, units, targets) => ({
  id, source, targets,
  tokens: units.map(([surface, lemma, reading, pos, key]) => ({ surface, lemma, reading, pos, key: key || "" }))
});
const GAKKOU = ["学校", "学校", "がっこう", "noun", "学校|がっこう"];
const WA = ["は", "は", "は", "particle"], NI = ["に", "に", "に", "particle"], DOT = ["。", "。", "。", "punctuation"];
const IKU = ["行きます", "行く", "いきます", "verb", "行く|いく"];
const TOMODACHI = ["友達", "友達", "ともだち", "noun", "友達|ともだち"];
const KEIZAI = ["経済", "経済", "けいざい", "noun", "経済|けいざい"];

const card = { id: "学校|がっこう" };
const known = (...keys) => (key) => keys.includes(key);
const pick = (candidates, isKnown, stats = {}) => chooseSentence(card, { candidates, isKnown, statsOf: (id) => stats[id] });

test("sin frases para la palabra: null (se enseña la palabra sola)", () => {
  assert.equal(pick([], known()), null);
  assert.equal(pick([sentence("a", "text", [TOMODACHI, NI, IKU, DOT], ["友達|ともだち"])], known("行く|いく")), null);
});

test("todo lo demás conocido: se elige, con el índice de la unidad preguntada", () => {
  const result = pick([sentence("a", "text", [GAKKOU, NI, IKU, DOT], ["学校|がっこう"])], known("行く|いく"));
  assert.equal(result.sentence.id, "a");
  assert.equal(result.target, 0);
  assert.equal(result.extra, -1);
});

test("una palabra desconocida de más se admite y se señala; dos, no", () => {
  const one = sentence("a", "text", [TOMODACHI, WA, GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  assert.equal(pick([one], known("行く|いく")).extra, 0);            // 友達 sin conocer
  assert.equal(pick([one], known()), null);                          // 友達 y 行く sin conocer
  // La misma palabra desconocida dos veces cuenta una
  const twice = sentence("b", "text", [TOMODACHI, WA, TOMODACHI, NI, GAKKOU, DOT], ["学校|がっこう"]);
  assert.equal(pick([twice], known()).extra, 0);
  // Una unidad con contenido sin resolver cuenta como desconocida
  const loose = sentence("c", "text", [["謎", "謎", "なぞ", "noun", ""], WA, GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  assert.equal(pick([loose], known("行く|いく")).extra, 0);
  assert.equal(pick([loose], known()), null);
});

test("mejor la frase sin palabras desconocidas que la que tiene una", () => {
  const clean = sentence("ai1", "ai", [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  const extra = sentence("t1", "text", [KEIZAI, WA, GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  assert.equal(pick([extra, clean], known("行く|いく")).sentence.id, "ai1");
});

test("origen: primero las revisadas (propias y Tatoeba aprobada por la IA), luego las de IA y las de historias", () => {
  const make = (id, source) => sentence(id, source, [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  const all = [make("i", "ai"), make("u", "text"), make("t", "tatoeba")];
  assert.equal(pick(all, known("行く|いく")).sentence.id, "t");
  assert.equal(pick([make("i", "ai"), make("u", "text"), make("z", "curated")], known("行く|いく")).sentence.id, "z");
  // Las de historias ya no van antes que las de IA: las escribió la IA también
  assert.equal(pick([make("u", "text"), make("i", "ai")], known("行く|いく")).sentence.id, "i");
});

test("no repite la que acaba de salir y va alternando", () => {
  const make = (id) => sentence(id, "text", [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  const all = [make("a"), make("b"), make("c")], stats = {}, order = [];
  for (let turn = 1; turn <= 6; turn++) {
    const { sentence: chosen } = pick(all, known("行く|いく"), stats);
    order.push(chosen.id);
    stats[chosen.id] = { shown: (stats[chosen.id]?.shown || 0) + 1, lastShown: turn };
  }
  assert.deepEqual(order, ["a", "b", "c", "a", "b", "c"]);
  // Con una sola frase se repite: no hay otra
  assert.equal(pick([all[0]], known("行く|いく"), { a: { shown: 9, lastShown: 9 } }).sentence.id, "a");
});

test("una frase de Tatoeba muy vista cede el sitio a una de IA", () => {
  const make = (id, source) => sentence(id, source, [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  // "v" es la que acaba de salir; se compara "u" (Tatoeba) con "i" (IA, sin ver)
  const all = [make("u", "tatoeba"), make("v", "tatoeba"), make("i", "ai")];
  const stats = (shown) => ({ u: { shown, lastShown: 1 }, v: { shown: 9, lastShown: 2 } });
  assert.equal(pick(all, known("行く|いく"), stats(2)).sentence.id, "u");
  assert.equal(pick(all, known("行く|いく"), stats(6)).sentence.id, "i");
});

test("se descarta la frase donde la palabra se lee de otra forma", () => {
  const wrong = sentence("a", "ai", [["今日", "今日", "こんにち", "noun", "今日|きょう"], WA, GAKKOU, DOT], ["今日|きょう"]);
  assert.equal(chooseSentence({ id: "今日|きょう" }, { candidates: [wrong], isKnown: () => true }), null);
  const right = sentence("b", "ai", [["今日", "今日", "きょう", "noun", "今日|きょう"], WA, GAKKOU, DOT], ["今日|きょう"]);
  assert.equal(chooseSentence({ id: "今日|きょう" }, { candidates: [wrong, right], isKnown: () => true }).sentence.id, "b");
  // Conjugada: 行った leído いった vale para 行く
  const verb = sentence("c", "ai", [GAKKOU, NI, ["行った", "行く", "いった", "verb", "行く|いく"], DOT], ["行く|いく"]);
  assert.equal(chooseSentence({ id: "行く|いく" }, { candidates: [verb], isKnown: () => true }).target, 2);
});

test("kanjiSounds: cómo suena cada kanji dentro de su unidad", () => {
  const BANK = loadBank();
  const info = (c) => BANK.kanji.get(c);
  assert.deepEqual(kanjiSounds("学校", "がっこう", ["学|がく", "校|こう"], info), ["がっ", "こう"]);
  assert.deepEqual(kanjiSounds("日本語", "にほんご", ["日|に", "本|ほん", "語|ご"], info), ["に", "ほん", "ご"]);
  assert.deepEqual(kanjiSounds("行った", "いった", ["行|い"], info), ["い", "", ""]);           // conjugada
  assert.deepEqual(kanjiSounds("来ます", "きます", ["来|く"], info), ["き", "", ""]);           // irregular
  assert.deepEqual(kanjiSounds("時々", "ときどき", ["時|とき", "時|とき"], info), ["とき", "どき"]);
  assert.deepEqual(kanjiSounds("終わります", "おわります", ["終|おわ"], info), ["お", "", "", "", ""]); // okurigana en la etiqueta
  assert.deepEqual(kanjiSounds("今日", "きょう", ["今日|きょう"], info), ["きょう", null]);     // se leen juntos
  assert.equal(kanjiSounds("学校", "がくせい", ["学|がく", "校|こう"], info), null);             // no cuadra
});

test("chooseKanjiSentence: la frase del kanji, sin repetir la última y sin tocar su palabra", () => {
  const NIHONGO = ["日本語", "日本語", "にほんご", "noun", "日本語|にほんご"];
  const MAINICHI = ["毎日", "毎日", "まいにち", "noun", "毎日|まいにち"];
  const BENKYOU = ["勉強しています", "勉強", "べんきょうしています", "verb", "勉強|べんきょう"];
  const WO = ["を", "を", "を", "particle"];
  const make = (id) => ({ sentence: sentence(id, "text", [MAINICHI, NIHONGO, WO, BENKYOU, DOT], ["日本語|にほんご"]),
    target: 1, char: 2, sound: "ご", sounds: ["に", "ほん", "ご"], tag: "語|ご" });
  const state = (isKnown, stats = {}) => ({ candidates: [make("a"), make("b")], isKnown, statsOf: (id) => stats[id] });
  const all = known("毎日|まいにち", "日本語|にほんご", "勉強|べんきょう");
  const result = chooseKanjiSentence(state(all));
  assert.equal(result.sentence.id, "a");
  assert.equal(result.sound, "ご");
  assert.equal(result.extra, -1);
  assert.ok(!("shown" in result));
  // La última que salió se evita si hay otra
  assert.equal(chooseKanjiSentence(state(all, { a: { shown: 1, lastShown: 5 } })).sentence.id, "b");
  // Su palabra sin conocer cuenta como la desconocida de más, pero no se puede tocar
  assert.equal(chooseKanjiSentence(state(known("毎日|まいにち", "勉強|べんきょう"))).extra, -1);
  assert.equal(chooseKanjiSentence(state(known("毎日|まいにち"))), null);
  assert.equal(chooseKanjiSentence({ candidates: [], isKnown: all }), null);
});
