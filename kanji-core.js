/* =========================================
   KANJI LEARNING APP - kanji-core.js
   Lo que se sabe de cada kanji, deducido de las PALABRAS que conoce el
   estudiante: un kanji se aprende en contexto, no suelto. Sin navegador ni
   datos del usuario alrededor, para poder probarlo con Node. Se carga después
   de sentences-core.js; lo usan kanji-table.js, study.js (una casilla por
   kanji al escribir la lectura) y tools/build-kanji.mjs.

   Cada kanji tiene sus lecturas RELEVANTES: las que aparecen en palabras del
   banco (bank/kanji-info.js, con cuántas palabras usa cada una). Las raras
   (nanori, lecturas que ninguna palabra usa) no cuentan.
     mastered  sabe su significado y ha visto todas sus lecturas relevantes en
               palabras que conoce
     partial   aparece en alguna palabra que conoce, pero le falta alguna
               lectura relevante o el significado
     unknown   no está en ninguna palabra que conozca
   Los números (cuántas palabras hacen relevante una lectura) vienen de
   STUDY_CONFIG.kanji.
   ========================================= */

const KC_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const KC_STATES = ["mastered", "partial", "unknown"];

/* =========================================
   1. LECTURAS (para tools/build-kanji.mjs)
   -----------------------------------------
   bank/readings.js da la lectura de diccionario de cada kanji en cada palabra
   (学校 がっこう -> 学|がく). Casi siempre coincide con una de KANJIDIC2; si
   no, suele ser una kun con parte de su okurigana dentro, porque la palabra
   se escribe sin ella: 売上 うりあげ -> 売|うり, que es う (う.る).
   ========================================= */

/* La lectura de diccionario de un kanji tal como sale en una palabra, o null
   si no es ninguna de las suyas (お兄さん にい, 真っ赤…: lecturas especiales
   que no se enseñan como lectura del kanji).
     reading  la lectura de bank/readings.js, en hiragana
     info     { on: ["ジョウ"], kun: ["あ.げる"] } con TODAS las de KANJIDIC2
     variants kanjiVariants de sentences-core.js (sonidos -> lectura de diccionario) */
function normalizeKanjiReading(reading, info, variants) {
  if (!reading || !/^[ぁ-ゖー]+$/.test(reading)) return null;
  // Una lectura que KANJIDIC2 da tal cual es esa: 上 じょう (上手) y しょう (上人) son dos
  // lecturas, aunque al leer frases una cuente como la sonora de la otra (kanjiVariants)
  const own = [...(info?.on || []), ...(info?.kun || [])].map((r) => kcHiragana(r).replace(/-/g, "").split(".")[0]);
  if (own.includes(reading)) return reading;
  const map = variants(info);
  const base = map.get(reading);
  if (base) return base;
  // Con okurigana dentro: あげ = あ + げ (あ.げる); うり = う + り, la forma en -i de う.る
  // (売上); きっ = き + っ (切手: き.る)
  for (const kun of info?.kun || []) {
    const [stem, okurigana = ""] = kcHiragana(kun).replace(/-/g, "").split(".");
    if (!okurigana) continue;
    const iForm = okurigana.length === 1 && KC_I_FORM[okurigana];
    for (const [sound, original] of map) {
      if (original !== stem || !reading.startsWith(sound)) continue;
      const rest = reading.slice(sound.length);
      if (rest && (okurigana.startsWith(rest) || rest === iForm || rest === "っ")) return stem;
    }
  }
  return null;
}

/* Cómo suena cada parte de una palabra: lo que se escribe en cada casilla.
     writing, reading  la palabra (上手, じょうず)
     tags              sus etiquetas de bank/readings.js, en orden (["上|しょう", "手|ず"])
     variants          kanji -> sonidos -> lectura de diccionario (kanjiVariants(info))
   Devuelve [[parte, sonido, etiqueta]] en orden, con las partes en kana como
   [kana, kana, null], o null si la lectura no encaja con las etiquetas.
   bank/readings.js guarda la lectura de diccionario (上手 -> 上|しょう, como
   上人); el sonido de verdad, じょう, sale de aquí. */
function wordSounds(writing, reading, tags, variants) {
  const chars = [...String(writing)];
  const target = kcHiragana(reading);
  const parts = (tags || []).map((tag) => tag.split("|"));
  const out = [];
  const walk = (i, j, t) => {
    if (i === chars.length) return j === target.length && t === parts.length;
    const c = chars[i];
    if (!/\p{Script=Han}|々/u.test(c)) {
      if (target[j] !== kcHiragana(c)) return false;
      out.push([c, target[j], null]);
      if (walk(i + 1, j + 1, t)) return true;
      out.pop();
      return false;
    }
    if (t >= parts.length) return false;
    const [kanji, base] = parts[t];
    const size = [...kanji].length;
    if (size > 1 || c === "々" || kanji !== c) {
      // Varios kanjis leídos juntos (今日), o 々: la parte entera con su lectura tal cual
      const text = chars.slice(i, i + size).join("");
      for (const sound of kcSoundsOf(base, kanji, variants)) {
        if (!target.startsWith(sound, j)) continue;
        out.push([text, sound, parts[t].join("|")]);
        if (walk(i + size, j + sound.length, t + 1)) return true;
        out.pop();
      }
      return false;
    }
    for (const sound of kcSoundsOf(base, kanji, variants)) {
      if (!target.startsWith(sound, j)) continue;
      out.push([c, sound, parts[t].join("|")]);
      if (walk(i + 1, j + sound.length, t + 1)) return true;
      out.pop();
    }
    return false;
  };
  return walk(0, 0, 0) ? out : null;
}

/* Los sonidos posibles de una etiqueta: la lectura tal cual, la que lleva
   okurigana dentro (うり) y las formas que kanjiVariants lleva a esa lectura
   (しょう <- じょう, がく <- がっ), de la más larga a la más corta */
function kcSoundsOf(base, kanji, variants) {
  const sounds = new Set([base]);
  if ([...kanji].length === 1) for (const [sound, original] of variants(kanji)) if (original === base) sounds.add(sound);
  return [...sounds].sort((a, b) => b.length - a.length);
}

/* Terminación de un verbo -> la de su forma en -i (書く -> 書き, 売る -> 売り) */
const KC_I_FORM = { う: "い", く: "き", ぐ: "ぎ", す: "し", つ: "ち", ぬ: "に", ぶ: "び", む: "み", る: "り" };

const kcHiragana = (text) => String(text).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/* Peso de una palabra según su puesto en la lista de frecuencia: la 1 vale 1,
   la 100 vale 0,5 y la 900, 0,1. Sin puesto, 0. */
const frequencyWeight = (rank) => rank > 0 ? 100 / (rank + 99) : 0;

/* =========================================
   2. ESTADO DE CADA KANJI
   ========================================= */

/* Lecturas relevantes de un kanji: las que usan al menos minWords palabras del
   banco, y siempre la más usada (un kanji con una sola palabra también tiene
   una). readings: [[lectura, palabras, palabras de la lista de frecuencia]],
   de más a menos usada. */
function relevantReadings(readings, config) {
  return (readings || []).filter(([, words], i) => i === 0 || words >= config.relevantMinWords).map(([reading]) => reading);
}

/* Las lecturas de kanji de una palabra: [[kanji, lectura]], sin los grupos de
   varios kanjis (今日|きょう) ni las lecturas especiales (お兄さん にい).
     tags      sus etiquetas "kanji|lectura" (unpackTags de bank/readings.js)
     override  la corrección de bank/kanji-info.js para esa palabra, si la hay:
               "上じょう,手ず" ("" si no ejercita ninguna lectura de sus kanjis) */
function wordKanjiReadings(tags, override) {
  if (typeof override === "string") {
    return override ? override.split(",").map((part) => [[...part][0], [...part].slice(1).join("")]) : [];
  }
  return (tags || []).map((tag) => tag.split("|")).filter(([kanji]) => [...kanji].length === 1);
}

/* El estado de todos los kanjis.
     kanji         Map carácter -> { readings: [[lectura, palabras, lista]] } (bank/kanji-info.js)
     knownWords    [{ id, readings: [[kanji, lectura]] }]: las palabras que conoce (wordKanjiReadings)
     meaningKnown  carácter -> ¿sabe su significado? (lo marcó, lo acertó o el kanji
                   es una palabra que conoce: 山)
     config        STUDY_CONFIG.kanji
   Devuelve Map carácter -> { state, meaning, known: [lecturas vistas],
   missing: [lecturas relevantes sin ver], words: [ids de palabras conocidas] }.
   Los kanjis de palabras conocidas que no están en `kanji` también salen. */
function kanjiStates({ kanji, knownWords, meaningKnown, config }) {
  const seen = new Map(); // carácter -> { readings: Set, words: [] }
  for (const word of knownWords) {
    for (const [c, reading] of word.readings) {
      const entry = seen.get(c) || { readings: new Set(), words: [] };
      entry.readings.add(reading);
      if (!entry.words.includes(word.id)) entry.words.push(word.id);
      seen.set(c, entry);
    }
  }
  const out = new Map();
  for (const c of new Set([...kanji.keys(), ...seen.keys()])) {
    const relevant = relevantReadings(kanji.get(c)?.readings, config);
    const entry = seen.get(c);
    const meaning = !!meaningKnown(c);
    const known = relevant.filter((reading) => entry?.readings.has(reading));
    // Lecturas vistas que no son relevantes (poco usadas): se enseñan, pero no hacen falta
    const extra = entry ? [...entry.readings].filter((reading) => !relevant.includes(reading)) : [];
    const missing = relevant.filter((reading) => !entry?.readings.has(reading));
    const state = !entry ? "unknown" : meaning && !missing.length ? "mastered" : "partial";
    out.set(c, { state, meaning, known: [...known, ...extra], missing, words: entry?.words || [] });
  }
  return out;
}

/* =========================================
   3. GRUPOS DE LA TABLA
   -----------------------------------------
   jlpt       N5 … N1 (la lista JLPT del kanji)
   grade      grado escolar de KANJIDIC2: 1 a 6 (primaria) y 8 (secundaria)
   frequency  tramos por importancia: cuánto vocabulario frecuente abre
   Lo que no está en ninguno va a "other".
   ========================================= */

const KC_FREQUENCY_BANDS = [100, 250, 500, 1000, 1500, 2000, 2500];

/* La clave del grupo de un kanji.  info: { level, grade, importance } */
function kanjiGroup(info, by) {
  if (by === "grade") return info.grade >= 1 && info.grade <= 8 ? `grade${info.grade}` : "other";
  if (by === "frequency") {
    const band = KC_FREQUENCY_BANDS.find((top) => info.importance && info.importance <= top);
    return band ? `top${band}` : "other";
  }
  return KC_LEVELS.includes(info.level) ? info.level : "other";
}

/* Los grupos en orden, cada uno con sus kanjis ordenados y la cuenta por estado.
     list     [{ c, level, grade, importance, freq }]
     stateOf  carácter -> estado
   Devuelve [{ key, kanji: [c], counts: { mastered, partial, unknown, total } }] (sin grupos vacíos) */
function kanjiGroups(list, by, stateOf) {
  const keys = by === "grade" ? ["grade1", "grade2", "grade3", "grade4", "grade5", "grade6", "grade8"]
    : by === "frequency" ? KC_FREQUENCY_BANDS.map((top) => `top${top}`) : [...KC_LEVELS];
  const groups = new Map([...keys, "other"].map((key) => [key, []]));
  for (const info of list) groups.get(kanjiGroup(info, by)).push(info);
  // Dentro de cada grupo, los más importantes primero; luego por frecuencia en prensa
  const order = (a, b) => (a.importance || Infinity) - (b.importance || Infinity) ||
    (a.freq || Infinity) - (b.freq || Infinity) || a.c.localeCompare(b.c);
  return [...groups].filter(([, items]) => items.length).map(([key, items]) => {
    const counts = { mastered: 0, partial: 0, unknown: 0, total: items.length };
    for (const info of items) counts[stateOf(info.c)]++;
    return { key, kanji: items.sort(order).map((info) => info.c), counts };
  });
}

/* =========================================
   4. UNA CASILLA POR KANJI
   -----------------------------------------
   Al escribir la lectura de una palabra («Palabra sola»), cada kanji tiene su
   casilla y el kana va escrito entre ellas: 前置き -> [まえ][お]き. Así se sabe
   qué kanji falló, no solo la palabra. Lo que suena cada kanji sale de
   wordSounds; si no encaja, se pregunta con una sola casilla, como antes.
   ========================================= */

/* Las casillas de una palabra.
     sounds    wordSounds(...) de la palabra
     readings  sus lecturas de kanji (wordKanjiReadings): a qué lectura del kanji
               cuenta cada casilla
   Devuelve [{ text, sound, kanji, reading }] (en las partes en kana, kana: true
   y sin casilla), o null si no hay reparto o si la palabra es una sola casilla
   (山 やま, 今日 きょう: no aporta nada). kanji y reading son null en las
   partes que no cuentan para un kanji (今日 きょう, お兄さん にい). */
function readingBoxes(sounds, readings) {
  if (!sounds) return null;
  const left = [...(readings || [])];
  const boxes = sounds.map(([text, sound, tag]) => {
    if (!tag) return { text, sound, kana: true };
    const kanji = tag.split("|")[0];
    if ([...kanji].length !== 1) return { text, sound, kanji: null, reading: null };
    const at = left.findIndex(([c]) => c === kanji);
    const reading = at >= 0 ? left.splice(at, 1)[0][1] : null;
    return { text, sound, kanji, reading };
  });
  return boxes.filter((box) => !box.kana).length > 1 ? boxes : null;
}

/* Corrige las casillas. typed: lo escrito en cada una (ya en hiragana), en orden.
   Devuelve { correct, ok: [por casilla], results: [[kanji, lectura, acertó]] } */
function gradeBoxes(boxes, typed, normalize = (text) => kcHiragana(String(text).trim())) {
  const asked = boxes.filter((box) => !box.kana);
  const ok = asked.map((box, i) => normalize(typed[i] || "") === normalize(box.sound));
  const results = asked.map((box, i) => [box.kanji, box.reading, ok[i]]).filter(([kanji, reading]) => kanji && reading);
  return { correct: ok.every(Boolean), ok, results };
}

/* Suma un resultado a las lecturas de un kanji (userKanji[c].readings):
   { "めい": { ok: aciertos, ko: fallos, last: "2026-10-26" } } */
function addReadingResult(readings, reading, correct, day) {
  const entry = readings[reading] ??= { ok: 0, ko: 0, last: "" };
  entry[correct ? "ok" : "ko"]++;
  entry.last = day;
  return readings;
}

/* =========================================
   5. DEMOSTRAR LOS KANJIS DE UN NIVEL
   -----------------------------------------
   Una prueba, nivel a nivel desde N5, de los kanjis que ya ha visto en sus
   palabras: de cada uno, su significado (elegir entre 4) y cómo suena en una
   palabra que conoce (escribirlo: 名 en 有名 -> めい). Un kanji queda
   demostrado si acierta las dos; un nivel, completo cuando todos sus kanjis
   lo están. Los que ya sabía (significado demostrado y alguna lectura
   acertada en su casilla) cuentan como demostrados sin prueba.
   Los números vienen de STUDY_CONFIG.kanjiProof.
   ========================================= */

/* Cómo va cada nivel.  kanjiOf(level) -> [c];  seen(c), proven(c) -> bool
   Devuelve [{ level, total, seen, proven, pending: [vistos sin demostrar], complete }] */
function proofLevels(kanjiOf, seen, proven) {
  return KC_LEVELS.map((level) => {
    const list = kanjiOf(level) || [];
    const done = list.filter(proven);
    return {
      level, total: list.length, seen: list.filter((c) => seen(c) || proven(c)).length, proven: done.length,
      pending: list.filter((c) => seen(c) && !proven(c)), complete: list.length > 0 && done.length === list.length
    };
  });
}

/* El nivel que toca demostrar: el más bajo con kanjis vistos sin demostrar (o null) */
const nextProofLevel = (rows) => rows.find((row) => row.pending.length) || null;

/* Las preguntas de una prueba.
     pending  kanjis por demostrar, en el orden en que conviene (los de palabras que mejor conoce antes)
     data     { meaning(c) -> texto, word(c) -> { id, w, r, sound } | null (una palabra que conoce con él
              y cómo suena allí), others(c) -> [significados de otros kanjis del nivel] }
     config   { size }
   Solo entran los que tienen significado, palabra y al menos 3 significados de otros
   para las opciones. Devuelve [{ c, meaning, options: [4], word }]. */
function buildProof(pending, data, config, random = Math.random) {
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const questions = [];
  for (const c of pending) {
    if (questions.length >= config.size) break;
    const meaning = data.meaning(c), word = data.word(c);
    const others = [...new Set(data.others(c).filter((text) => text && text !== meaning))];
    if (!meaning || !word || others.length < 3) continue;
    questions.push({ c, meaning, options: shuffle([meaning, ...shuffle(others).slice(0, 3)]), word });
  }
  return questions;
}

/* Corrige una pregunta.  answer: { choice: el significado elegido, typed: lo escrito } */
function gradeProof(question, answer, normalize = (text) => kcHiragana(String(text).trim())) {
  const meaningOk = answer.choice === question.meaning;
  const readingOk = !!answer.typed && normalize(answer.typed) === normalize(question.word.sound);
  return { meaningOk, readingOk, ok: meaningOk && readingOk };
}

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    KC_LEVELS, KC_STATES, KC_FREQUENCY_BANDS, normalizeKanjiReading, frequencyWeight, relevantReadings,
    wordSounds, wordKanjiReadings, kanjiStates, kanjiGroup, kanjiGroups, readingBoxes, gradeBoxes, addReadingResult,
    proofLevels, nextProofLevel, buildProof, gradeProof
  };
}
