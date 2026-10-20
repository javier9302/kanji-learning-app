const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEntry, rowsOf, buildRows, priority } = require("../tools/lib/jmdict.js");

/* Entradas de JMdict en su XML, recortadas */
const ENTRY = {
  居る: `<k_ele><keb>居る</keb><ke_inf>&rK;</ke_inf></k_ele><r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
    <sense><pos>&v1;</pos><misc>&uk;</misc><gloss>to be (of animate objects)</gloss><gloss>to exist</gloss></sense>
    <sense><misc>&uk;</misc><gloss>to stay</gloss></sense><sense><gloss xml:lang="spa">estar (objetos animados)</gloss></sense>`,
  要る: `<k_ele><keb>要る</keb><ke_pri>news2</ke_pri><ke_pri>spec1</ke_pri></k_ele><r_ele><reb>いる</reb><re_pri>news2</re_pri><re_pri>spec1</re_pri></r_ele>
    <sense><pos>&v5r;</pos><misc>&uk;</misc><gloss>to be needed</gloss></sense><sense><gloss xml:lang="spa">necesitar</gloss></sense>`,
  成る: `<k_ele><keb>成る</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>なる</reb><re_pri>ichi1</re_pri></r_ele>
    <sense><misc>&uk;</misc><gloss>to become</gloss></sense><sense><misc>&uk;</misc><gloss>to result in</gloss></sense>
    <sense><misc>&uk;</misc><gloss>to be completed</gloss></sense><sense><gloss>to consist of</gloss></sense>`,
  生る: `<k_ele><keb>生る</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf07</ke_pri></k_ele><r_ele><reb>なる</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf07</re_pri></r_ele>
    <sense><misc>&uk;</misc><gloss>to bear fruit</gloss></sense>`,
  物: `<k_ele><keb>物</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>もの</reb><re_pri>ichi1</re_pri></r_ele><sense><gloss>thing</gloss><gloss>object</gloss></sense><sense><gloss xml:lang="spa">cosa</gloss></sense>`,
  もの: `<r_ele><reb>もの</reb><re_pri>ichi1</re_pri></r_ele><sense><misc>&uk;</misc><gloss>indicates reason or excuse</gloss></sense>`,
  稀: `<k_ele><keb>稀覯</keb></k_ele><r_ele><reb>きこう</reb></r_ele><sense><gloss>rare (book)</gloss></sense>`,
  学校: `<k_ele><keb>学校</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri></k_ele><r_ele><reb>がっこう</reb><re_pri>ichi1</re_pri></r_ele><sense><gloss>school</gloss></sense><sense><gloss xml:lang="spa">escuela</gloss></sense>`,
  AtoB: `<k_ele><keb>A&amp;B</keb><ke_pri>gai1</ke_pri></k_ele><r_ele><reb>エーアンドビー</reb><re_pri>gai1</re_pri></r_ele><sense><gloss>A &amp; B</gloss></sense>`
};
const parse = (name) => parseEntry(ENTRY[name]);
const kana = (rows, lemma) => rows.find((row) => row[0] === lemma && row[1] === lemma);

test("parseEntry lee escrituras, lecturas, prioridades, marcas y significados por idioma", () => {
  const entry = parse("居る");
  assert.deepEqual(entry.kebs, [{ text: "居る", pri: [], inf: ["rK"] }]);
  assert.deepEqual(entry.rebs[0].text, "いる");
  assert.deepEqual(entry.senses[0].misc, ["uk"]);
  assert.deepEqual(entry.senses[0].gloss, [{ lang: "eng", text: "to be (of animate objects)" }, { lang: "eng", text: "to exist" }]);
  assert.deepEqual(entry.senses[2].gloss, [{ lang: "spa", text: "estar (objetos animados)" }]);
  assert.equal(parse("AtoB").kebs[0].text, "A&B");                  // entidades XML decodificadas
});

test("solo palabras comunes, con escritura normal + lectura y su significado en los dos idiomas", () => {
  assert.deepEqual(rowsOf(parse("学校")).map((r) => r.row), [["学校", "がっこう", ["school"], ["escuela"], 0]]);
  assert.deepEqual(rowsOf(parse("稀")), []);                         // no es común
  // 居る es una escritura rara: solo queda su forma en kana
  assert.deepEqual(rowsOf(parse("居る")).map((r) => r.row[0]), ["いる"]);
  assert.ok(priority(["ichi1", "news1", "nf07"]) > priority(["news2"]));
});

test("varias palabras que se escriben igual en kana: gana la que es de verdad esa palabra", () => {
  const rows = buildRows(["要る", "居る", "生る", "成る", "物", "もの"].map(parse));
  assert.equal(kana(rows, "いる")[2][0], "to be (of animate objects)");   // y no "to be needed"
  assert.equal(kana(rows, "なる")[2][0], "to become");                    // y no "to bear fruit"
  assert.equal(kana(rows, "もの")[2][0], "thing");                        // preferencia a mano: 物
  // Una sola fila por escritura y lectura
  assert.equal(rows.filter((row) => row[0] === "いる").length, 1);
  // Las escrituras con kanji siguen ahí
  assert.ok(rows.some((row) => row[0] === "要る" && row[2][0] === "to be needed"));
});

test("lo que ya está en el banco no se repite", () => {
  const rows = buildRows([parse("学校"), parse("物")], (w, r) => w === "学校" && r === "がっこう");
  assert.ok(!rows.some((row) => row[0] === "学校"));
  assert.ok(rows.some((row) => row[0] === "物"));
});

test("el archivo publicado tiene los significados buenos de las palabras más frecuentes en kana", () => {
  const list = require("../vendor/jmdict/common-2026-10-20.json");
  const first = new Map();
  for (const row of list) if (row[0] === row[1] && !first.has(row[0])) first.set(row[0], row);
  const meaning = (word) => first.get(word)?.[2][0];
  assert.match(meaning("いる"), /^to be/);
  assert.match(meaning("する"), /^to do/);
  assert.match(meaning("なる"), /^to become/);
  assert.equal(meaning("この"), "this");
  assert.equal(meaning("とても"), "very");
  assert.equal(meaning("もの"), "thing");
  assert.ok(list.length > 20000);
  assert.ok(list.every((row) => row.length === 5 && Array.isArray(row[2]) && row[2].length));
});
