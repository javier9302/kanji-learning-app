/* Palabras que llegan de la web (etapa 3): qué se acepta de la dirección, la
   oración alrededor de la selección, qué unidad es la palabra, el marcador y
   la frase guardada que manda en el repaso. */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readCapture, sentenceAround, findWordUnit, bookmarkletCode, safeSourceUrl, cleanCaptured } = require("../capture-core.js");
const { chooseCapturedSentence, buildSentence } = require("../sentences-core.js");
const { segmentSentence } = require("../ja-core.js");
const { tokensFor, wordOf, tagsOf } = require("../tools/lib/analyse.js");
const { loadTokenizer } = require("../tools/lib/tokenizer.js");

const query = (params) => `?${new URLSearchParams(params)}`;

test("readCapture: palabra, frase y página del enlace", () => {
  assert.deepEqual(readCapture(query({ add: "食べました", sentence: "昨日すしを食べました。", source: "https://example.com/a?b=1" })),
    { word: "食べました", sentence: "昨日すしを食べました。", source: "https://example.com/a?b=1" });
  assert.equal(readCapture(""), null);
  assert.equal(readCapture("?view=study"), null);
});

test("readCapture: lo que no se acepta se descarta", () => {
  // Una página que no es http(s) no se guarda: no se podría abrir sin peligro
  assert.equal(readCapture(query({ add: "猫", source: "javascript:alert(1)" })).source, "");
  assert.equal(safeSourceUrl("data:text/html,<b>x</b>"), "");
  assert.equal(safeSourceUrl("http://a.jp/"), "http://a.jp/");
  // Sin japonés no hay nada que agregar
  assert.equal(readCapture(query({ add: "hello" })), null);
  // La frase solo vale si contiene la palabra
  assert.equal(readCapture(query({ add: "猫", sentence: "犬が好きです。" })).sentence, "");
  // Caracteres de control y espacios seguidos fuera; la palabra, como mucho 30 caracteres
  assert.equal(cleanCaptured("猫\u0000​  が\n好き", 100), "猫 が 好き");
  assert.equal(readCapture(query({ add: "<b>猫" })).word, "<b>猫"); // se escapa al enseñarlo, no aquí
});

test("readCapture: si lo seleccionado es una frase, la palabra se elige dentro de ella", () => {
  const capture = readCapture(query({ add: "毎朝コーヒーを飲みます。", source: "https://a.jp/" }));
  assert.deepEqual(capture, { word: "", sentence: "毎朝コーヒーを飲みます。", source: "https://a.jp/" });
});

test("readCapture: lo compartido desde Android, con la página dentro del texto", () => {
  assert.deepEqual(readCapture(query({ share_text: "“勉強” https://news.example.jp/x" })),
    { word: "勉強", sentence: "", source: "https://news.example.jp/x" });
  assert.deepEqual(readCapture(query({ share_text: "今日は雨が降っています。", share_url: "https://a.jp/" })),
    { word: "", sentence: "今日は雨が降っています。", source: "https://a.jp/" });
  // Sin japonés en el texto, el título
  assert.equal(readCapture(query({ share_title: "天気", share_text: "https://a.jp/" })).word, "天気");
});

test("sentenceAround: la oración que contiene la selección", () => {
  const text = "おはよう。今日は雨が降っています。「傘を持って行きます。」と言った。明日は晴れ。";
  const at = (word) => sentenceAround(text, text.indexOf(word), text.indexOf(word) + word.length);
  assert.equal(at("雨"), "今日は雨が降っています。");
  assert.equal(at("晴れ"), "明日は晴れ。");
  assert.equal(at("おはよう"), "おはよう。");
  // El cierre de comillas va con su oración
  assert.equal(at("傘"), "「傘を持って行きます。」");
  // Un salto de línea también corta
  assert.equal(sentenceAround("見出し\n本文の猫です", 7, 8), "本文の猫です");
  // Una oración enorme se recorta alrededor de la selección
  const long = "あ".repeat(500) + "猫" + "い".repeat(500);
  const cut = sentenceAround(long, 500, 501);
  assert.ok(cut.includes("猫") && cut.length <= 300, String(cut.length));
});

test("findWordUnit: la unidad de la palabra, también conjugada o a medias", () => {
  const tokens = [
    { surface: "昨日", pos: "noun" }, { surface: "すし", pos: "noun" }, { surface: "を", pos: "particle" },
    { surface: "食べました", pos: "verb" }, { surface: "。", pos: "punctuation" }
  ];
  assert.equal(findWordUnit(tokens, "食べました"), 3);
  assert.equal(findWordUnit(tokens, "食べ"), 3);         // seleccionó solo la raíz
  assert.equal(findWordUnit(tokens, "すしを"), 1);       // la partícula no cuenta
  assert.equal(findWordUnit(tokens, "を"), -1);
  assert.equal(findWordUnit(tokens, "猫"), -1);
  // La palabra sale dos veces: vale la posición donde se seleccionó
  const twice = [{ surface: "本", pos: "noun" }, { surface: "と", pos: "particle" }, { surface: "本", pos: "noun" }];
  assert.equal(findWordUnit(twice, "本", 2), 2);
});

test("el marcador es código válido y funciona en una página", () => {
  const code = bookmarkletCode("https://javier9302.github.io/kanji-learning-app/", "Selecciona una palabra");
  assert.ok(code.startsWith("javascript:") && !/\s/.test(code), "con espacios se rompe al guardarlo como dirección");
  // Una página mínima: un párrafo con la palabra seleccionada
  const text = "おはよう。今日は雨が降っています。";
  const paragraph = { nodeType: 1, textContent: text };
  const textNode = { nodeType: 3, parentElement: paragraph };
  const start = text.indexOf("雨");
  let opened = null;
  const page = {
    window: {
      getSelection: () => ({ toString: () => "雨", getRangeAt: () => ({ startContainer: textNode, startOffset: start }) }),
      open: (url) => { opened = url; return {}; }
    },
    document: { body: {}, createRange: () => { let end = 0; return { setStart() {}, setEnd(node, offset) { end = offset; }, toString: () => text.slice(0, end) }; } },
    getComputedStyle: () => ({ display: "block" }),
    location: { href: "https://news.example.jp/a" },
    alert: () => { throw new Error("no debería avisar"); }
  };
  page.window.document = page.document;
  vm.runInNewContext(decodeURIComponent(code.slice("javascript:".length)), { ...page, ...page.window });
  const capture = readCapture(new URL(opened).search);
  assert.deepEqual(capture, { word: "雨", sentence: "今日は雨が降っています。", source: "https://news.example.jp/a" });
});

test("una frase real: se encuentra la palabra con su forma de diccionario", async () => {
  const tokenizer = await loadTokenizer();
  const tokens = await tokensFor(segmentSentence(tokenizer, "昨日、友達と寿司を食べました。"));
  const index = findWordUnit(tokens, "食べました");
  assert.equal(tokens[index].key, "食べる|たべる");
});

test("chooseCapturedSentence: la frase guardada de la web manda, aunque tenga palabras desconocidas", async () => {
  const tokenizer = await loadTokenizer();
  const make = async (id, ja, word) => ({
    ...buildSentence({ id, tokens: await tokensFor(segmentSentence(tokenizer, ja)), source: "web", wordOf, tagsOf }), word
  });
  const one = await make("web:1", "政府は新しい経済対策を発表しました。", "経済|けいざい");
  const two = await make("web:2", "経済の本を読みました。", "経済|けいざい");
  const other = { ...one, id: "web:3", word: "政府|せいふ" };
  const text = { ...two, id: "t:1", source: "text", word: undefined };
  const stats = { "web:1": { lastShown: 200 }, "web:2": { lastShown: 100 } };
  const pick = chooseCapturedSentence({ id: "経済|けいざい" }, { candidates: [one, two, other, text], statsOf: (id) => stats[id] });
  // La que hace más que no sale; con la palabra marcada
  assert.equal(pick.sentence.id, "web:2");
  assert.equal(pick.sentence.tokens[pick.target].surface, "経済");
  assert.ok(pick.captured && pick.extra === -1);
  // Las de otras palabras o de los textos no cuentan
  assert.equal(chooseCapturedSentence({ id: "経済|けいざい" }, { candidates: [other, text] }), null);
  // Si la palabra se lee distinto en la frase, no vale
  assert.equal(chooseCapturedSentence({ id: "経済|きょうざい" }, { candidates: [{ ...one, word: "経済|きょうざい" }] }), null);
});
