const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../translate-core.js");
const { loadStudyConfig } = require("../tools/lib/config.js");

const CONFIG = loadStudyConfig().translate;
const DAY = 86400000, NOW = 1000 * DAY;

/* Frase mínima: unidades [superficie, tipo, clave]; por defecto con traducción */
const sentence = (id, units, extra = {}) => ({
  id, sourceId: "t1", en: "reference", es: "referencia", ...extra,
  tokens: units.map(([surface, pos, key]) => ({ surface, lemma: surface, reading: "", pos, key: key || "" }))
});
const N = (word) => [word, "noun", `${word}|x`];
const WA = ["は", "particle"], DOT = ["。", "punctuation"];
const words = (map) => (key) => map[key.split("|")[0]] || { known: true, status: "mastered" };
const choose = (candidates, wordOf = words({}), more = {}) =>
  core.chooseTranslationSentence({ candidates, wordOf, lastSeenOf: () => 0, now: NOW, ...more }, CONFIG);

test("isTranslatable: hace falta traducción, longitud dentro de los límites y todo resuelto", () => {
  const ok = sentence("a", [N("学校"), WA, N("毎日"), DOT]);
  assert.ok(core.isTranslatable(ok, CONFIG));
  assert.ok(core.isTranslatable({ ...ok, es: "" }, CONFIG));                 // con una sola traducción vale
  assert.ok(!core.isTranslatable({ ...ok, en: "", es: "" }, CONFIG));        // texto pegado: sin referencia
  assert.ok(!core.isTranslatable(sentence("b", [N("本"), DOT]), CONFIG));    // demasiado corta
  assert.ok(!core.isTranslatable(sentence("c", [N("学".repeat(41)), DOT]), CONFIG));
  assert.ok(core.isTranslatable(sentence("d", [N("学".repeat(40)), DOT, DOT]), CONFIG)); // la puntuación no cuenta
  assert.ok(!core.isTranslatable(sentence("e", [N("学校"), WA, ["謎々", "noun", ""], DOT]), CONFIG)); // sin resolver
  assert.ok(!core.isTranslatable(sentence("f", [WA, WA, WA, WA, DOT]), CONFIG)); // sin palabras con contenido
});

test("sin frases válidas devuelve null", () => {
  assert.equal(choose([]), null);
  assert.equal(choose([sentence("a", [N("学校"), WA, N("毎日"), DOT], { en: "", es: "" })]), null);
});

test("con más palabras desconocidas que el máximo, la frase no sale", () => {
  const hard = sentence("a", [N("経済"), WA, N("政治"), WA, N("社会"), DOT]);
  const unknown = { known: false, status: "unknown" };
  assert.equal(choose([hard], words({ 経済: unknown, 政治: unknown, 社会: unknown })), null);
  assert.equal(choose([hard], words({ 経済: unknown, 政治: unknown })).id, "a");
});

test("mejor una frase con una palabra por aprender que una en la que todo se domina", () => {
  const easy = sentence("a", [N("学校"), WA, N("毎日"), DOT]);
  const useful = sentence("b", [N("学校"), WA, N("経済"), DOT]);
  assert.equal(choose([easy, useful], words({ 経済: { known: false, status: "learning" } })).id, "b");
});

test("favorece las palabras consultadas y las falladas", () => {
  const a = sentence("a", [N("学校"), WA, N("毎日"), DOT]);
  const b = sentence("b", [N("学校"), WA, N("毎朝"), DOT]);
  assert.equal(choose([a, b], words({ 毎朝: { known: true, status: "mastered", lookups: 2 } })).id, "b");
  assert.equal(choose([a, b], words({ 毎日: { known: true, status: "mastered", failures: 1 } })).id, "a");
});

test("evita la que salió hace poco, y deja de evitarla con los días", () => {
  const a = sentence("a", [N("学校"), WA, N("経済"), DOT]);   // la más interesante
  const b = sentence("b", [N("学校"), WA, N("毎日"), DOT]);
  const wordOf = words({ 経済: { known: false, status: "learning" } });
  assert.equal(choose([a, b], wordOf).id, "a");
  assert.equal(choose([a, b], wordOf, { lastSeenOf: (id) => id === "a" ? NOW - 3600000 : 0 }).id, "b");
  assert.equal(choose([a, b], wordOf, { lastSeenOf: (id) => id === "a" ? NOW - 6 * DAY : 0 }).id, "a");
});

test("reparte entre textos: a igualdad, la de otro texto", () => {
  const same = sentence("a", [N("学校"), WA, N("毎日"), DOT], { sourceId: "t1" });
  const other = sentence("b", [N("学校"), WA, N("毎日"), DOT], { sourceId: "t2" });
  assert.equal(choose([same, other], words({}), { lastTextId: "t1" }).id, "b");
  assert.equal(choose([same, other], words({}), { lastTextId: "t2" }).id, "a");
});

test("a igualdad total, la que hace más que no sale", () => {
  const a = sentence("a", [N("学校"), WA, N("毎日"), DOT]);
  const b = sentence("b", [N("学校"), WA, N("毎日"), DOT]);
  const seen = { a: NOW - 20 * DAY, b: NOW - 30 * DAY };
  assert.equal(choose([a, b], words({}), { lastSeenOf: (id) => seen[id] }).id, "b");
});

test("normalizeAnswer: espacios, caracteres de control y longitud", () => {
  assert.equal(core.normalizeAnswer("  Bebo   café\n todas\tlas mañanas.  "), "Bebo café todas las mañanas.");
  assert.equal(core.normalizeAnswer("hola\u0000\u0007 mundo\u200b\u202e!"), "hola mundo !");
  assert.equal(core.normalizeAnswer("\u0001\u0002  "), "");
  assert.equal(core.normalizeAnswer(null), "");
  assert.equal(core.normalizeAnswer("a".repeat(150)).length, 100);
  assert.equal(core.normalizeAnswer("añ" + "o".repeat(200), 5), "añooo");
  assert.equal([...core.normalizeAnswer("😀".repeat(120))].length, 100);   // cuenta caracteres, no unidades UTF-16
  assert.equal(core.normalizeAnswer("abcd ef", 5), "abcd");               // no deja un espacio al final al recortar
});

test("answerProblem: vacía o demasiado corta se rechaza sin llamar a la IA", () => {
  assert.equal(core.answerProblem("", CONFIG), "empty");
  assert.equal(core.answerProblem("sí", CONFIG), "short");
  assert.equal(core.answerProblem("... 12 !!", CONFIG), "short");   // solo cuentan las letras
  assert.equal(core.answerProblem("voy", CONFIG), "");
  assert.equal(core.answerProblem("I go to school.", CONFIG), "");
});

test("localResult: todas las palabras con contenido, una vez cada una", () => {
  const s = sentence("a", [N("学校"), WA, N("毎日"), WA, N("学校"), DOT]);
  const right = core.localResult(s, "self", "correct");
  assert.deepEqual(right.words.map((w) => [w.lemma, w.understood]), [["学校", true], ["毎日", true]]);
  assert.equal(right.score, 100);
  assert.deepEqual(core.localResult(s, "unknown", "incorrect").words.map((w) => w.understood), [false, false]);
  assert.deepEqual(core.localResult(s, "self", "partial").words.map((w) => w.understood), [null, null]); // no se sabe cuáles
});
