const test = require("node:test");
const assert = require("node:assert/strict");
const { kanjiVariants, canonicalReading, alignReading, tagsFromFurigana, packTags, unpackTags } = require("../sentences-core.js");
const { loadBank } = require("../tools/lib/bank.js");

const BANK = loadBank();
const info = (c) => BANK.kanji.get(c);

test("kanjiVariants: lecturas tal cual, con rendaku y con っ", () => {
  const gaku = kanjiVariants(info("学"));
  assert.equal(gaku.get("がく"), "がく");
  assert.equal(gaku.get("がっ"), "がく");   // 学校
  assert.equal(gaku.get("まな"), "まな");   // 学ぶ
  assert.equal(kanjiVariants(info("時")).get("どき"), "とき"); // 時々
  assert.equal(kanjiVariants(info("分")).get("ぷん"), "ふん"); // 一分
});

test("canonicalReading devuelve la lectura de diccionario, o la misma si no la reconoce", () => {
  assert.equal(canonicalReading("がっ", info("学")), "がく");
  assert.equal(canonicalReading("サン", info("山")), "さん");
  assert.equal(canonicalReading("ぞぞ", info("山")), "ぞぞ");
});

test("alignReading reparte la lectura entre los kanjis", () => {
  assert.deepEqual(alignReading("学校", "がっこう", info), ["学|がく", "校|こう"]);
  assert.deepEqual(alignReading("山", "やま", info), ["山|やま"]);
  assert.deepEqual(alignReading("飲み物", "のみもの", info), ["飲|の", "物|もの"]);
  assert.deepEqual(alignReading("時々", "ときどき", info), ["時|とき", "時|とき"]);
  assert.deepEqual(alignReading("お金", "おかね", info), ["金|かね"]);
});

test("alignReading no inventa: sin reparto claro devuelve null", () => {
  assert.equal(alignReading("今日", "きょう", info), null);   // lectura de la palabra entera
  assert.equal(alignReading("大人", "おとな", info), null);
  assert.equal(alignReading("お父さん", "おとうさん", info), null); // とう no es una lectura de 父 en el banco
  assert.equal(alignReading("学校", "がっこ", info), null);   // sobra o falta lectura
});

test("tagsFromFurigana: segmentos de JmdictFurigana -> etiquetas", () => {
  assert.deepEqual(tagsFromFurigana([["学", "がっ"], ["校", "こう"]], info), ["学|がく", "校|こう"]);
  assert.deepEqual(tagsFromFurigana([["今日", "きょう"]], info), ["今日|きょう"]);
  assert.deepEqual(tagsFromFurigana([["お", ""], ["手", "て"], ["洗", "あら"], ["い", ""]], info), ["手|て", "洗|あら"]);
  assert.deepEqual(tagsFromFurigana([["時", "とき"], ["々", "どき"]], info), ["時|とき", "時|とき"]);
});

test("packTags y unpackTags son inversas", () => {
  for (const tags of [["学|がく", "校|こう"], ["今日|きょう"], ["山|さん"], []]) {
    assert.deepEqual(unpackTags(packTags(tags)), tags);
  }
});

test("bank/readings.js cubre todas las palabras con kanji del banco", () => {
  const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
  let readings = null;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../bank/readings.js"), "utf8"),
    { BANK: { setReadings: (value) => { readings = value; } } });
  const missing = [...BANK.words.values()].filter((word) => word.kanji.length && !readings[word.id]);
  assert.deepEqual(missing.map((word) => word.id), []);
  assert.deepEqual(unpackTags(readings["学校|がっこう"]), ["学|がく", "校|こう"]);
  assert.deepEqual(unpackTags(readings["今日|きょう"]), ["今日|きょう"]);
  // Cada etiqueta habla de kanjis que la palabra tiene de verdad
  for (const word of BANK.words.values()) {
    for (const tag of unpackTags(readings[word.id] || "")) {
      const [kanji, reading] = tag.split("|");
      assert.ok(reading && [...kanji].every((c) => word.w.includes(c)), `${word.id}: ${tag}`);
    }
  }
});

test("bank/kanji-info.js: cada kanji de una palabra del banco tiene sus lecturas y su información", () => {
  const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
  const rows = {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../bank/kanji-info.js"), "utf8"),
    vm.createContext({ BANK: { setKanjiInfo: (data) => Object.assign(rows, data) } }));
  assert.ok(Object.keys(rows).length > 2000);
  const [level, grade, , importance, readings] = rows["名"];
  assert.equal(level, "N5");
  assert.equal(grade, 1);
  assert.ok(importance > 0);
  assert.equal(readings.map(([reading]) => reading).slice(0, 2).join(), "めい,な");
  for (const word of BANK.words.values()) {
    if (word.kana) continue;
    for (const c of word.kanji) assert.ok(rows[c], `falta ${c} (${word.w})`);
  }
});
