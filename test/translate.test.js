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

test("a igualdad, la frase con palabras que toca repasar va antes, también por delante de las que está aprendiendo", () => {
  const plain = sentence("a", [N("学校"), WA, N("毎日"), DOT]);
  const due = sentence("b", [N("名前"), WA, N("毎日"), DOT]);
  const learning = sentence("c", [N("会社"), WA, N("毎日"), DOT]);
  const wordOf = words({ 名前: { known: true, status: "learning", due: true }, 会社: { known: true, status: "learning" } });
  assert.equal(choose([plain, learning, due], wordOf).id, "b");
  assert.equal(choose([plain, learning], wordOf).id, "c"); // sin ninguna que toque, como antes
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

test("compareWithReference: idéntica salvo mayúsculas, acentos, puntuación y artículos", () => {
  const same = (a, b) => core.compareWithReference(a, b);
  assert.equal(same("Bebo café todas las mañanas.", "bebo cafe todas mañanas"), 1);
  assert.equal(same("I drink coffee every morning", "I drink the coffee every morning!"), 1);
  assert.equal(same("I don't drink coffee", "I do not drink coffee."), 1);
  assert.equal(same("", "algo"), 0);
  assert.equal(same("el la los", "el perro"), 0);            // solo artículos: nada que comparar
});

test("compareWithReference no da por buena una respuesta que cambia el significado", () => {
  const ratio = (a, b) => core.compareWithReference(a, b);
  const LIMIT = CONFIG.localMatch;
  // negación
  assert.ok(ratio("I drink coffee every morning", "I do not drink coffee every morning") < LIMIT);
  assert.ok(ratio("No bebo café por la mañana", "Bebo café por la mañana") < LIMIT);
  // otro número, otra persona, otro tiempo
  assert.ok(ratio("Compré tres libros ayer", "Compré dos libros ayer") < LIMIT);
  assert.ok(ratio("He goes to school every day", "I go to school every day") < LIMIT);
  assert.ok(ratio("Fui a la escuela con mi amigo", "Voy a la escuela con mi amigo") < LIMIT);
  // mismas palabras en otro orden
  assert.ok(ratio("el perro mordió al hombre", "el hombre mordió al perro") < LIMIT);
  // sobra o falta información
  assert.ok(ratio("Bebo café", "Bebo café todas las mañanas") < LIMIT);
  assert.ok(ratio("Bebo café todas las mañanas con mi madre en casa", "Bebo café todas las mañanas") < LIMIT);
});

test("matchesReference: vale la referencia en cualquiera de los dos idiomas", () => {
  const s = { es: "Bebo café todas las mañanas.", en: "I drink coffee every morning." };
  assert.ok(core.matchesReference("bebo cafe todas las mañanas", s, CONFIG));
  assert.ok(core.matchesReference("I drink coffee every morning", s, CONFIG));
  assert.ok(!core.matchesReference("Tomo café cada mañana", s, CONFIG));     // buena, pero eso lo decide la IA
  assert.ok(!core.matchesReference("yes", { es: "", en: "Yes." }, CONFIG));  // referencia demasiado corta
  assert.ok(!core.matchesReference("hola", { es: "", en: "" }, CONFIG));
});

test("answerKey: la misma respuesta escrita de otra forma es la misma", () => {
  assert.equal(core.answerKey("s1", "Bebo café."), core.answerKey("s1", "  bebo   CAFE "));
  assert.notEqual(core.answerKey("s1", "Bebo café"), core.answerKey("s2", "Bebo café"));
  assert.notEqual(core.answerKey("s1", "Bebo café"), core.answerKey("s1", "No bebo café"));
  assert.notEqual(core.answerKey("s1", "Bebo el café"), core.answerKey("s1", "Bebo café"));
});

/* ---------- applyTranslationResult ---------- */

const FSRS_FIELDS = { studied: true, fsrs: { due: "2026-12-01T00:00:00.000Z", stability: 12.5, state: 2 }, nextReview: "2026-12-01",
  interval: 12, repetitions: 4, ease: 2.5, lastReviewed: "2026-11-19T10:00:00.000Z", correctCount: 4, incorrectCount: 1, streakDays: 2 };

/* Usuario de mentira. words: { clave: registro }; credited: claves a las que esta frase ya sumó */
function user({ words: mine = {}, kanji = {}, lookups = [], credited = [] } = {}) {
  return {
    wordOf: (key) => mine[key] ? { id: key, lemma: key.split("|")[0], reading: key.split("|")[1], ...mine[key] } : null,
    kanjiOf: (c) => kanji[c] ? { id: c, ...kanji[c] } : null,
    readingOf: (key) => key.split("|")[1],
    wordsWith: (c) => Object.entries(mine).filter(([key]) => key.split("|")[0].includes(c)).map(([key, rec]) => ({ id: key, ...rec })),
    credited: (key) => credited.includes(key),
    lookups: new Set(lookups), now: NOW, today: "2026-10-12"
  };
}
const graded = (source, verdict, words) => ({ source, verdict, words: Object.entries(words).map(([key, understood]) => ({ key, lemma: key.split("|")[0], understood })) });
const apply = (result, state) => core.applyTranslationResult(result, { id: "s1" }, state, CONFIG);
const byId = (list) => Object.fromEntries(list.map((rec) => [rec.id, rec]));

test("progreso: nunca toca el repaso espaciado de la lectura", () => {
  const state = user({ words: { "学校|がっこう": { status: "learning", ...FSRS_FIELDS }, "毎朝|まいあさ": { status: "mastered", ...FSRS_FIELDS } } });
  const { words } = apply(graded("ai", "partial", { "学校|がっこう": true, "毎朝|まいあさ": false }), state);
  assert.equal(words.length, 2);
  for (const rec of words) {
    for (const [field, value] of Object.entries(FSRS_FIELDS)) assert.deepEqual(rec[field], value, `${rec.id}.${field}`);
  }
  // Y no cambia los registros que le pasan: devuelve copias
  assert.equal(state.wordOf("毎朝|まいあさ").status, "mastered");
});

test("progreso: el primer acierto solo se apunta; el segundo, en otra frase, da el significado por sabido", () => {
  const first = byId(apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known" } } })).words)["学校|がっこう"];
  assert.deepEqual([first.meaningCorrect, first.knowsMeaning, first.status, first.lastMeaningAt], [1, undefined, "pre_known", NOW]);

  const second = apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } } }));
  const rec = second.words[0];
  assert.deepEqual([rec.meaningCorrect, rec.knowsMeaning, rec.status], [2, true, "mastered"]);
  assert.deepEqual(second.summary.promoted, ["学校|がっこう"]);
});

test("progreso: la misma frase no suma dos veces a la misma palabra", () => {
  const state = user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } }, credited: ["学校|がっこう"] });
  const rec = apply(graded("ai", "correct", { "学校|がっこう": true }), state).words[0];
  assert.deepEqual([rec.meaningCorrect, rec.knowsMeaning, rec.status], [1, undefined, "pre_known"]);
});

test("progreso: \"aprendiendo\" y \"desconocida\" ganan el significado, pero no pasan a dominadas", () => {
  for (const status of ["learning", "unknown"]) {
    const rec = apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status, meaningCorrect: 1 } } })).words[0];
    assert.deepEqual([rec.knowsMeaning, rec.status], [true, status]);
  }
});

test("progreso: el crédito depende de quién corrige", () => {
  const points = (source) => apply(graded(source, "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known" } } })).words[0].meaningCorrect;
  assert.equal(points("ai"), CONFIG.credit.ai);
  assert.equal(points("local"), CONFIG.credit.local);
  assert.equal(points("self"), CONFIG.credit.self);
  assert.equal(points("contested"), CONFIG.credit.contested);
  assert.ok(CONFIG.credit.ai > CONFIG.credit.local && CONFIG.credit.ai > CONFIG.credit.self && CONFIG.credit.ai > CONFIG.credit.contested);
  // Con medio punto por frase hacen falta cuatro frases, no dos
  const slow = apply(graded("self", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } } })).words[0];
  assert.deepEqual([slow.meaningCorrect, slow.knowsMeaning, slow.status], [1.5, undefined, "pre_known"]);
});

test("progreso: un fallo la pone en aprendiendo, borra los aciertos seguidos y cuenta como fallo", () => {
  const state = user({ words: { "毎朝|まいあさ": { status: "mastered", knowsMeaning: true, meaningCorrect: 2, meaningWrong: 1 } } });
  const { words, summary } = apply(graded("ai", "partial", { "毎朝|まいあさ": false }), state);
  assert.deepEqual([words[0].status, words[0].knowsMeaning, words[0].meaningCorrect, words[0].meaningWrong, words[0].lastMeaningAt],
    ["learning", false, 0, 2, NOW]);
  assert.deepEqual(summary.failed, ["毎朝|まいあさ"]);
  // Tras un fallo hacen falta otra vez los N aciertos
  const again = apply(graded("ai", "correct", { "毎朝|まいあさ": true }), user({ words: { "毎朝|まいあさ": { ...words[0] } } })).words[0];
  assert.deepEqual([again.meaningCorrect, again.knowsMeaning, again.status], [1, false, "learning"]);
});

test("progreso: null no cambia nada en una palabra que ya tenía registro", () => {
  const { words } = apply(graded("ai", "mostly", { "学校|がっこう": null }), user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } } }));
  assert.deepEqual(words, []);
});

test("progreso: una palabra consultada no suma aunque se entienda, pero un fallo sí cuenta", () => {
  const state = user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1, lookups: 2 }, "毎朝|まいあさ": { status: "pre_known" } }, lookups: ["学校|がっこう", "毎朝|まいあさ"] });
  const { words, summary } = apply(graded("ai", "partial", { "学校|がっこう": true, "毎朝|まいあさ": false }), state);
  const recs = byId(words);
  assert.deepEqual([recs["学校|がっこう"].meaningCorrect, recs["学校|がっこう"].knowsMeaning, recs["学校|がっこう"].lookups, recs["学校|がっこう"].status], [1, undefined, 3, "pre_known"]);
  assert.deepEqual([recs["毎朝|まいあさ"].meaningWrong, recs["毎朝|まいあさ"].lookups, recs["毎朝|まいあさ"].status], [1, 1, "learning"]);
  assert.deepEqual(summary.looked.sort(), ["学校|がっこう", "毎朝|まいあさ"].sort());
  assert.deepEqual(summary.understood, []);
});

test("progreso: una palabra sin registro queda como vista, con origen traducir", () => {
  const { words } = apply(graded("ai", "mostly", { "学校|がっこう": null, "毎朝|まいあさ": true, "友達|ともだち": false }), user());
  const recs = byId(words);
  assert.deepEqual([recs["学校|がっこう"].status, recs["学校|がっこう"].origin, recs["学校|がっこう"].seen, recs["学校|がっこう"].reading], ["pre_known", "traducir", 1, "がっこう"]);
  assert.equal(recs["学校|がっこう"].meaningCorrect, undefined);
  assert.deepEqual([recs["毎朝|まいあさ"].status, recs["毎朝|まいあさ"].meaningCorrect], ["pre_known", 1]);
  assert.deepEqual([recs["友達|ともだち"].status, recs["友達|ともだち"].meaningWrong], ["learning", 1]);
  assert.ok(words.every((rec) => !rec.studied && !rec.fsrs));
});

test("progreso: \"No lo sé\" cuenta como no entendida en todas las palabras", () => {
  const sentenceRecord = sentence("s1", [N("学校"), WA, N("毎朝"), DOT]);
  const result = core.localResult(sentenceRecord, "unknown", "incorrect");
  const out = core.applyTranslationResult(result, sentenceRecord, user(), CONFIG);
  assert.ok(out.words.length === 2 && out.words.every((rec) => rec.status === "learning" && rec.meaningWrong === 1));
  assert.deepEqual(out.day, { t: 1, tc: 0 });
});

test("progreso: historial del día", () => {
  assert.deepEqual(apply(graded("ai", "correct", {}), user()).day, { t: 1, tc: 1 });
  assert.deepEqual(apply(graded("ai", "mostly", {}), user()).day, { t: 1, tc: 1 });
  assert.deepEqual(apply(graded("ai", "partial", {}), user()).day, { t: 1, tc: 0 });
  assert.deepEqual(apply(graded("self", "incorrect", {}), user()).day, { t: 1, tc: 0 });
});

test("kanji: una palabra entendida no basta; hacen falta varias distintas con ese kanji", () => {
  const known = { status: "mastered", knowsMeaning: true, meaningCorrect: 2 };
  // 学校 se promociona ahora: es la primera palabra con 学 y con 校
  let out = apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } } }));
  let kanji = byId(out.kanji);
  assert.deepEqual([kanji["学"].meaningCorrect, kanji["学"].knowsMeaning, kanji["学"].status], [1, false, "unknown"]);
  // Con dos palabras tampoco
  out = apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 }, "学生|がくせい": known } }));
  assert.deepEqual([byId(out.kanji)["学"].meaningCorrect, byId(out.kanji)["学"].knowsMeaning], [2, false]);
  // La tercera palabra distinta con 学 da su significado por sabido; 校 solo lleva una
  out = apply(graded("ai", "correct", { "学校|がっこう": true }),
    user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 }, "学生|がくせい": known, "大学|だいがく": known } }));
  kanji = byId(out.kanji);
  assert.deepEqual([kanji["学"].meaningCorrect, kanji["学"].knowsMeaning], [CONFIG.kanjiWords, true]);
  assert.deepEqual([kanji["校"].meaningCorrect, kanji["校"].knowsMeaning], [1, false]);
});

test("kanji: no cuentan las palabras sin los N aciertos, ni se toca un kanji sin novedades", () => {
  const known = { status: "mastered", knowsMeaning: true, meaningCorrect: 2 };
  // knowsMeaning puesto por otro camino (evaluación de lectura), sin aciertos en Traducir: no respalda
  const other = { status: "mastered", knowsMeaning: true };
  let out = apply(graded("ai", "correct", { "学校|がっこう": true }),
    user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 }, "学生|がくせい": known, "大学|だいがく": other } }));
  assert.equal(byId(out.kanji)["学"].knowsMeaning, false);
  // Un primer acierto (sin promoción) no mueve los kanjis
  out = apply(graded("ai", "correct", { "学校|がっこう": true }), user({ words: { "学校|がっこう": { status: "pre_known" } } }));
  assert.deepEqual(out.kanji, []);
  // El progreso de escritura y repaso del kanji se conserva
  out = apply(graded("ai", "correct", { "学校|がっこう": true }),
    user({ words: { "学校|がっこう": { status: "pre_known", meaningCorrect: 1 } }, kanji: { 学: { status: "learning", canWrite: true, writes: 3, ...FSRS_FIELDS } } }));
  const rec = byId(out.kanji)["学"];
  assert.deepEqual([rec.canWrite, rec.writes, rec.status, rec.fsrs, rec.nextReview], [true, 3, "learning", FSRS_FIELDS.fsrs, FSRS_FIELDS.nextReview]);
});

test("kanji: si una palabra que lo respaldaba se falla, deja de contar", () => {
  const known = { status: "mastered", knowsMeaning: true, meaningCorrect: 2 };
  const out = apply(graded("ai", "partial", { "学校|がっこう": false }),
    user({ words: { "学校|がっこう": known, "学生|がくせい": known, "大学|だいがく": known }, kanji: { 学: { knowsMeaning: true, meaningCorrect: 3 } } }));
  const rec = byId(out.kanji)["学"];
  assert.equal(rec.meaningCorrect, 2);
  assert.equal(rec.knowsMeaning, true); // lo ya demostrado del kanji no se quita por un fallo en una palabra
});
