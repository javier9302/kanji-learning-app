const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseSentence } = require("../sentences-core.js");

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

test("origen: primero las de sus textos, luego Tatoeba, luego IA", () => {
  const make = (id, source) => sentence(id, source, [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  const all = [make("i", "ai"), make("t", "tatoeba"), make("u", "text")];
  assert.equal(pick(all, known("行く|いく")).sentence.id, "u");
  assert.equal(pick(all.slice(0, 2), known("行く|いく")).sentence.id, "t");
  assert.equal(pick([make("i", "ai"), make("p", "article")], known("行く|いく")).sentence.id, "p");
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

test("una frase propia muy vista cede el sitio a una de Tatoeba", () => {
  const make = (id, source) => sentence(id, source, [GAKKOU, NI, IKU, DOT], ["学校|がっこう"]);
  // "v" es la que acaba de salir; se compara "u" (propia) con "t" (Tatoeba, sin ver)
  const all = [make("u", "text"), make("v", "text"), make("t", "tatoeba")];
  const stats = (shown) => ({ u: { shown, lastShown: 1 }, v: { shown: 9, lastShown: 2 } });
  assert.equal(pick(all, known("行く|いく"), stats(2)).sentence.id, "u");
  assert.equal(pick(all, known("行く|いく"), stats(6)).sentence.id, "t");
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
