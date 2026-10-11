/* =========================================
   KANJI LEARNING APP - sentences-core.js
   Frases de ejemplo: todo lo que no depende del navegador ni de los datos del
   usuario. Lo usan igual la app (se carga después de ja-core.js) y las
   herramientas de tools/ con Node, para que haya una sola versión de cada regla.

   1. Lecturas de kanji: qué lectura de cada kanji ejercita una palabra
      (学校 がっこう -> 学 がく + 校 こう). De ahí salen las etiquetas
      "kanji|lectura" de cada frase.
   ========================================= */

/* =========================================
   1. LECTURAS DE KANJI
   -----------------------------------------
   Una etiqueta es "kanji|lectura" con la lectura de diccionario del kanji, no
   la que suena dentro de la palabra: en 学校 (がっこう) la etiqueta es 学|がく.
   Cuando varios kanjis se leen juntos sin poder repartirse (今日 きょう) la
   etiqueta lleva los dos: 今日|きょう.
   ========================================= */

const scHiragana = (text) => String(text).normalize("NFKC")
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const scIsKanji = (c) => c !== "々" && /\p{Script=Han}/u.test(c);
const scIsKanaChar = (c) => /[ぁ-ゖァ-ヺー]/.test(c);

const RENDAKU = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご", さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど", は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ"
};
const HANDAKU = { は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ" };

/* Formas en que puede sonar una lectura dentro de una palabra -> su lectura de
   diccionario. info: { on: ["ガク"], kun: ["まな.ぶ"] } (como en el banco). */
function kanjiVariants(info) {
  const variants = new Map();
  const add = (sound, base) => { if (sound && !variants.has(sound)) variants.set(sound, base); };
  const bases = [];
  for (const on of info?.on || []) bases.push(scHiragana(on).replace(/[.\-]/g, ""));
  for (const kun of info?.kun || []) {
    const clean = scHiragana(kun).replace(/-/g, "");
    bases.push(clean.split(".")[0]);              // い.く -> い
    if (clean.includes(".")) bases.push(clean.replace(".", "")); // はな.し -> はなし (話)
  }
  // Una lectura que solo es otra con la consonante sonora (-どき de とき) no es
  // una lectura distinta: cuenta como la original
  const voiced = new Map();
  for (const base of bases) {
    for (const table of [RENDAKU, HANDAKU]) if (table[base[0]]) voiced.set(table[base[0]] + base.slice(1), base);
  }
  for (const base of bases) add(base, voiced.has(base) && bases.includes(voiced.get(base)) ? voiced.get(base) : base);
  for (const base of bases) {
    if (variants.get(base) !== base) continue;
    const first = base[0], rest = base.slice(1), last = base[base.length - 1];
    const starts = [base];
    if (RENDAKU[first]) starts.push(RENDAKU[first] + rest);   // 時々 ときどき
    if (HANDAKU[first]) starts.push(HANDAKU[first] + rest);   // 一分 いっぷん
    for (const sound of starts) {
      add(sound, base);
      if (base.length > 1 && "つくきち".includes(last)) add(sound.slice(0, -1) + "っ", base); // 学校 がっこう
    }
  }
  return variants;
}

/* Lectura de diccionario de un kanji a partir de cómo suena en una palabra */
const canonicalReading = (sound, info) => kanjiVariants(info).get(scHiragana(sound)) || scHiragana(sound);

/* Reparte la lectura de una palabra entre sus kanjis usando solo las lecturas
   de cada kanji (sin diccionario de furigana). Devuelve las etiquetas
   ["学|がく", "校|こう"] o null si no hay un reparto claro.
   kanjiInfo(c) -> { on, kun } o undefined. */
function alignReading(writing, reading, kanjiInfo) {
  const chars = [...String(writing).normalize("NFKC")];
  const target = scHiragana(reading).replace(/[.\-\s・]/g, "");
  const found = []; // repartos completos: [{ tags, cost }]

  const walk = (i, j, tags, cost, previous) => {
    if (found.length > 8) return;
    if (i === chars.length) {
      if (j === target.length) found.push({ tags, cost });
      return;
    }
    const c = chars[i];
    if (!scIsKanji(c) && c !== "々") {
      const kana = scHiragana(c);
      // ー alarga la vocal anterior: en la lectura puede venir como ー o como vocal
      if (target[j] === kana || kana === "ー" && j < target.length) walk(i + 1, j + 1, tags, cost, previous);
      return;
    }
    const kanji = c === "々" ? previous : c;
    if (!kanji) return;
    for (const [sound, base] of kanjiVariants(kanjiInfo(kanji))) {
      if (target.startsWith(sound, j)) {
        walk(i + 1, j + sound.length, [...tags, `${kanji}|${base}`], cost + (sound === base ? 0 : 1), kanji);
      }
    }
  };
  walk(0, 0, [], 0, "");
  if (!found.length) return null;
  found.sort((a, b) => a.cost - b.cost);
  // Dos repartos igual de buenos y distintos: no se sabe cuál es
  if (found[1] && found[1].cost === found[0].cost && found[1].tags.join() !== found[0].tags.join()) return null;
  return found[0].tags;
}

/* Etiquetas de una palabra a partir del reparto de un diccionario de furigana
   (JmdictFurigana): segments = [[texto, lectura | ""]], en orden. */
function tagsFromFurigana(segments, kanjiInfo) {
  const tags = [];
  let previous = "";
  for (const [text, rt] of segments) {
    if (!rt) continue; // parte en kana
    const kanji = [...text].filter((c) => scIsKanji(c) || c === "々");
    if (!kanji.length) continue;
    if ([...text].length === 1) {
      const c = text === "々" ? previous : text;
      if (c) tags.push(`${c}|${canonicalReading(rt, kanjiInfo(c))}`);
      previous = c;
    } else {
      // Varios kanjis con una sola lectura: se intenta repartir; si no se puede, van juntos
      const split = alignReading(text, rt, kanjiInfo);
      tags.push(...(split || [`${text}|${scHiragana(rt)}`]));
      previous = kanji[kanji.length - 1];
    }
  }
  return tags;
}

/* "学がく,校こう" <-> ["学|がく", "校|こう"]: así se guardan en bank/readings.js */
const packTags = (tags) => tags.map((tag) => tag.replace("|", "")).join(",");
const unpackTags = (packed) => packed ? packed.split(",").map((part) => {
  const cut = [...part].findIndex(scIsKanaChar);
  return `${[...part].slice(0, cut).join("")}|${[...part].slice(cut).join("")}`;
}) : [];

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { kanjiVariants, canonicalReading, alignReading, tagsFromFurigana, packTags, unpackTags };
}
