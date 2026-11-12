/* =========================================
   KANJI LEARNING APP - kana-core.js
   Hiragana y katakana para quien empieza de cero. Sin navegador ni datos del
   usuario alrededor, para poder probarlo con Node. Se carga después de
   learning-core.js; la pantalla es kana.js.

   1. La tabla: KANA_ROWS, kanaRows y kanaItems (en el orden en que se aprende).
   2. La respuesta: kanaAnswerOk (rōmaji, con las variantes habituales).
   3. Qué toca: nextKanaLesson (repasos que vencen y, si cabe, una fila nueva).
   Los números vienen de STUDY_CONFIG.kana.
   ========================================= */

/* =========================================
   1. LA TABLA
   -----------------------------------------
   Por filas, como se enseña siempre: あいうえお, かきくけこ… Primero el hiragana
   entero (las 46 básicas y después las de ゛ y ゜), luego el katakana igual.
   Las combinaciones con ゃゅょ pequeña (きゃ) no van aquí: se leen juntando dos
   que ya se saben, y salen con sus palabras.
   Cada fila: [clave, hiragana, rōmaji de cada una]. El katakana está 0x60
   más allá en Unicode (あ U+3042 -> ア U+30A2).
   ========================================= */

const KANA_ROWS = [
  ["a", "あいうえお", "a i u e o"],
  ["ka", "かきくけこ", "ka ki ku ke ko"],
  ["sa", "さしすせそ", "sa shi su se so"],
  ["ta", "たちつてと", "ta chi tsu te to"],
  ["na", "なにぬねの", "na ni nu ne no"],
  ["ha", "はひふへほ", "ha hi fu he ho"],
  ["ma", "まみむめも", "ma mi mu me mo"],
  ["ya", "やゆよ", "ya yu yo"],
  ["ra", "らりるれろ", "ra ri ru re ro"],
  ["wa", "わをん", "wa o n"],
  ["ga", "がぎぐげご", "ga gi gu ge go"],
  ["za", "ざじずぜぞ", "za ji zu ze zo"],
  ["da", "だぢづでど", "da ji zu de do"],
  ["ba", "ばびぶべぼ", "ba bi bu be bo"],
  ["pa", "ぱぴぷぺぽ", "pa pi pu pe po"]
];
const KANA_BASIC_ROWS = 10; // las diez primeras filas son las básicas; el resto, con ゛ y ゜
const KANA_SCRIPTS = ["hiragana", "katakana"];

/* Otras formas de escribir el mismo sonido que también valen: quien viene de
   otro sistema escribe si, ti, tu, hu, zi; を es «o» al hablar y «wo» al teclear */
const KANA_ALSO = {
  し: ["si"], ち: ["ti"], つ: ["tu"], ふ: ["hu"], を: ["wo"], ん: ["nn"],
  じ: ["zi"], ぢ: ["di", "zi", "dji"], づ: ["du", "dzu"]
};

const toKatakanaChar = (c) => String.fromCharCode(c.charCodeAt(0) + 0x60);

/* Las filas en el orden en que se aprenden:
   [{ key: "hiragana-a", script, group: "basic" | "marks", chars: [{ id, romaji, accept }] }] */
function kanaRows() {
  const rows = [];
  for (const script of KANA_SCRIPTS) {
    KANA_ROWS.forEach(([key, kana, romaji], index) => {
      const sounds = romaji.split(" ");
      rows.push({
        key: `${script}-${key}`, script, group: index < KANA_BASIC_ROWS ? "basic" : "marks",
        chars: [...kana].map((c, i) => ({
          id: script === "hiragana" ? c : toKatakanaChar(c), romaji: sounds[i],
          accept: [sounds[i], ...(KANA_ALSO[c] || [])]
        }))
      });
    });
  }
  return rows;
}

/* Todas, una detrás de otra: Map id -> { id, romaji, accept, script, row } */
function kanaItems() {
  const items = new Map();
  for (const row of kanaRows()) for (const item of row.chars) items.set(item.id, { ...item, script: row.script, row: row.key });
  return items;
}

/* =========================================
   2. LA RESPUESTA
   ========================================= */

/* ¿Es ese su sonido? En rōmaji, sin mirar mayúsculas ni espacios. También vale
   escribir la propia kana (quien ya tiene teclado japonés). */
function kanaAnswerOk(item, typed) {
  const answer = String(typed ?? "").trim().toLowerCase().normalize("NFKC");
  return !!answer && (answer === item.id || item.accept.includes(answer));
}

/* =========================================
   3. QUÉ TOCA
   -----------------------------------------
   Cada kana tiene su tarjeta de repaso (FSRS, como las palabras). Una lección:
     1. las que vencen, la más atrasada primero;
     2. una fila nueva (la primera con alguna sin empezar), si hoy no ha
        empezado ya newPerDay kanas: una fila entera cada vez, que es como se
        recuerdan (あいうえお).
   ========================================= */

/* state:
     now          ahora (ms)
     dueAt(id)    cuándo vence su tarjeta (ms), o null si no la ha empezado
     newToday     kanas nuevas que ha empezado hoy
   config: STUDY_CONFIG.kana { newPerDay }
   Devuelve { due: [ids], fresh: [ids de la fila nueva], row: su clave o null,
     started, total, byScript: { hiragana: { started, total }, katakana: … },
     waitingNew: queda alguna sin empezar pero hoy ya no caben más } */
function nextKanaLesson(state, config) {
  const rows = kanaRows();
  const all = rows.flatMap((row) => row.chars.map((item) => item.id));
  const started = (id) => state.dueAt(id) !== null;
  const due = all.filter((id) => started(id) && state.dueAt(id) <= state.now).sort((a, b) => state.dueAt(a) - state.dueAt(b));
  const next = rows.find((row) => row.chars.some((item) => !started(item.id)));
  const room = state.newToday < config.newPerDay;
  const byScript = Object.fromEntries(KANA_SCRIPTS.map((script) => {
    const ids = rows.filter((row) => row.script === script).flatMap((row) => row.chars.map((item) => item.id));
    return [script, { started: ids.filter(started).length, total: ids.length }];
  }));
  return {
    due, fresh: next && room ? next.chars.map((item) => item.id).filter((id) => !started(id)) : [],
    row: next && room ? next.key : null,
    started: all.filter(started).length, total: all.length, byScript, waitingNew: !!next && !room
  };
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { KANA_ROWS, KANA_SCRIPTS, kanaRows, kanaItems, kanaAnswerOk, nextKanaLesson };
}
