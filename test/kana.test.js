const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../kana-core.js");
const { kanaToRomaji } = require("../ja-core.js");
const { loadStudyConfig } = require("../tools/lib/config.js");

const CONFIG = loadStudyConfig();
const DAY = 86400000;

test("la tabla: 71 hiragana y 71 katakana, por filas, sin repetir y con el rōmaji de la app", () => {
  const rows = core.kanaRows(), items = core.kanaItems();
  assert.equal(rows.length, 30);
  assert.equal(items.size, 142);
  assert.deepEqual(rows[0].chars.map((item) => item.id), ["あ", "い", "う", "え", "お"]);
  assert.equal(rows[0].key, "hiragana-a");
  assert.deepEqual(rows[15].chars.map((item) => item.id), ["ア", "イ", "ウ", "エ", "オ"]);
  assert.equal(items.get("ン").romaji, "n");
  assert.equal(items.get("ぱ").script, "hiragana");
  // El hiragana entero va antes que el katakana, y las básicas antes que las de ゛ y ゜
  assert.deepEqual([...new Set(rows.map((row) => `${row.script}-${row.group}`))], ["hiragana-basic", "hiragana-marks", "katakana-basic", "katakana-marks"]);
  // El mismo rōmaji que se enseña junto a las lecturas (kanaToRomaji); を se pronuncia «o»
  for (const item of items.values()) {
    if (!"をヲ".includes(item.id)) assert.equal(item.romaji, kanaToRomaji(item.id), item.id);
  }
});

test("kanaAnswerOk: rōmaji con sus variantes, sin mirar mayúsculas", () => {
  const items = core.kanaItems();
  assert.ok(core.kanaAnswerOk(items.get("し"), "shi"));
  assert.ok(core.kanaAnswerOk(items.get("し"), " SI "));
  assert.ok(core.kanaAnswerOk(items.get("ツ"), "tu"));
  assert.ok(core.kanaAnswerOk(items.get("ふ"), "hu"));
  assert.ok(core.kanaAnswerOk(items.get("を"), "wo") && core.kanaAnswerOk(items.get("を"), "o"));
  assert.ok(core.kanaAnswerOk(items.get("ん"), "n"));
  assert.ok(core.kanaAnswerOk(items.get("か"), "か"), "con teclado japonés, la propia kana");
  assert.ok(!core.kanaAnswerOk(items.get("か"), "ga"));
  assert.ok(!core.kanaAnswerOk(items.get("さ"), "shi"));
  assert.ok(!core.kanaAnswerOk(items.get("あ"), ""));
});

test("nextKanaLesson: primero lo que vence; una fila nueva entera si hoy caben más", () => {
  const now = Date.parse("2026-11-12T10:00:00Z"), K = CONFIG.kana;
  const lesson = (cards, newToday = 0) => core.nextKanaLesson({ now, dueAt: (id) => cards[id] ?? null, newToday }, K);
  // Sin empezar: la primera fila del hiragana
  const first = lesson({});
  assert.deepEqual(first.fresh, ["あ", "い", "う", "え", "お"]);
  assert.equal(first.row, "hiragana-a");
  assert.deepEqual([first.due.length, first.started, first.total], [0, 0, 142]);
  // Con la primera fila empezada: lo que vence (lo más atrasado antes) y la fila siguiente
  const cards = { あ: now - DAY, い: now - 3 * DAY, う: now + DAY, え: now, お: now + 5 * DAY };
  const second = lesson(cards, 5);
  assert.deepEqual(second.due, ["い", "あ", "え"]);
  assert.deepEqual(second.fresh, ["か", "き", "く", "け", "こ"]);
  assert.deepEqual(second.byScript.hiragana, { started: 5, total: 71 });
  // Hoy ya empezó las que caben: solo repasos, y lo dice
  const full = lesson(cards, K.newPerDay);
  assert.deepEqual(full.fresh, []);
  assert.equal(full.waitingNew, true);
  // Una fila a medias se termina antes de pasar a la siguiente
  assert.deepEqual(lesson({ あ: now + DAY, い: now + DAY }).fresh, ["う", "え", "お"]);
  // Todo empezado: no queda nada nuevo
  const all = Object.fromEntries([...core.kanaItems().keys()].map((id) => [id, now + DAY]));
  const done = lesson(all);
  assert.deepEqual([done.fresh.length, done.waitingNew, done.started], [0, false, 142]);
});
