/* =========================================
   KANJI LEARNING APP - sentences-core.js
   Frases de ejemplo: todo lo que no depende del navegador ni de los datos del
   usuario. Lo usan igual la app (se carga después de ja-core.js) y las
   herramientas de tools/ con Node, para que haya una sola versión de cada regla.

   1. Lecturas de kanji: qué lectura de cada kanji ejercita una palabra
      (学校 がっこう -> 学 がく + 校 こう). De ahí salen las etiquetas
      "kanji|lectura" de cada frase.
   2. La frase: su forma, cómo se monta y la comprobación única que decide si
      vale (validateSentence).
   3. Qué frase se enseña al repasar una palabra (chooseSentence).
   ========================================= */

/* =========================================
   1. LECTURAS DE KANJI
   -----------------------------------------
   Una etiqueta es "kanji|lectura" con la lectura de diccionario del kanji, no
   la que suena dentro de la palabra: en 学校 (がっこう) la etiqueta es 学|がく.
   Cuando varios kanjis se leen juntos sin poder repartirse (今日 きょう) la
   etiqueta lleva los dos: 今日|きょう.
   ========================================= */

// toHiragana está en ja-core.js (en Node se pide con require)
const scHiragana = typeof module !== "undefined" ? require("./ja-core.js").toHiragana : toHiragana;
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

/* 来る cambia la lectura de su kanji al conjugarse: 来ます き, 来ない こ */
const SC_IRREGULAR_SOUNDS = { "来": { "く": ["き", "こ"] } };

/* Cómo suena cada carácter de una unidad de la frase, repartiendo su lectura
   con las etiquetas de su palabra (las de JmdictFurigana, bank/readings.js):
   学校 がっこう + [学|がく, 校|こう] -> ["がっ", "こう"]. La unidad puede ir
   conjugada (行った いった -> ["い", "", ""]). Un carácter en kana lleva "";
   varios kanjis que se leen juntos (今日 きょう) llevan la lectura en el primero
   y null en los demás. null si no hay un reparto único. */
function kanjiSounds(surface, reading, tags, kanjiInfo) {
  const chars = [...surface];
  const target = scReading(reading || "");
  const single = new Map(), groups = [];
  for (const tag of tags || []) {
    const [text, base] = scKeyParts(tag);
    if ([...text].length > 1) groups.push([text, [...text].length, base]);
    else (single.get(text) || single.set(text, new Set()).get(text)).add(base);
  }
  const found = new Map(); // repartos distintos, por su forma escrita
  const walk = (i, j, sounds, previous) => {
    if (found.size > 1) return;
    if (i === chars.length) {
      if (j === target.length) found.set(JSON.stringify(sounds), sounds);
      return;
    }
    const c = chars[i];
    if (!scIsKanji(c) && c !== "々") {
      const kana = scHiragana(c);
      if (target[j] === kana || kana === "ー" && j < target.length) walk(i + 1, j + 1, [...sounds, ""], previous);
      return;
    }
    for (const [text, length, base] of groups) {
      if (chars.slice(i, i + length).join("") === text && target.startsWith(base, j)) {
        walk(i + length, j + base.length, [...sounds, base, ...Array(length - 1).fill(null)], chars[i + length - 1]);
      }
    }
    const kanji = c === "々" ? previous : c;
    const bases = kanji && single.get(kanji);
    if (!bases) return;
    const options = new Set(bases);
    for (const [sound, base] of kanjiVariants(kanjiInfo(kanji))) if (bases.has(base)) options.add(sound);
    for (const base of bases) {
      for (const sound of SC_IRREGULAR_SOUNDS[kanji]?.[base] || []) options.add(sound);
      // La etiqueta puede traer la okurigana que sigue (終|おわ en 終わります): el kanji es お
      for (let k = 1; k < [...base].length; k++) {
        if (base.endsWith(scHiragana(chars.slice(i + 1, i + 1 + k).join("")))) options.add(base.slice(0, -k));
      }
    }
    for (const sound of options) {
      if (target.startsWith(sound, j)) walk(i + 1, j + sound.length, [...sounds, sound], kanji);
    }
  };
  walk(0, 0, [], "");
  return found.size === 1 ? [...found.values()][0] : null;
}

/* =========================================
   2. LA FRASE
   -----------------------------------------
   Todas las frases, vengan de donde vengan, tienen la misma forma:
     { id, ja, tokens, en, es, source, sourceId, level, targets, kanjiReadings, attribution }
     ja             las unidades unidas con "|" (como los textos segmentados)
     tokens         [{ surface, lemma, reading, pos, key }]
                    reading: lectura de la unidad tal como está escrita
                    key: id de la palabra ("escritura|lectura"), "" si no se resolvió
     source         "text" (textos del usuario) | "article" (texto pegado) |
                    "tatoeba" | "ai"
     level          el nivel más alto de sus palabras
     targets        ids de las palabras que la frase sirve para preguntar. Es una
                    lista: hoy se pregunta una por tarjeta, pero una misma frase
                    puede servir a varias.
     kanjiReadings  ["学|がく", …] lecturas de kanji que ejercitan sus targets
   ========================================= */

const SC_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
/* Unidades que no son vocabulario: la lista está en ja-core.js (en Node se pide con require) */
const SC_UNCOUNTED = typeof module !== "undefined" ? require("./ja-core.js").UNCOUNTED_POS : UNCOUNTED_POS;
const scIsContent = (token) => !SC_UNCOUNTED.has(token.pos);
const scIsPunct = (token) => token.pos === "punctuation" || token.pos === "symbol";
const scHasKanji = (text) => /\p{Script=Han}/u.test(text);
const scReading = (text) => scHiragana(text).replace(/[.\-\s・]/g, "");
const scKeyParts = (key) => { const cut = key.lastIndexOf("|"); return [key.slice(0, cut), key.slice(cut + 1)]; };

/* 来る cambia la lectura de su kanji al conjugarse (きます, こない) */
const SC_IRREGULAR = { "来る": ["く", "き", "こ"] };

/* ¿La unidad se lee como espera la tarjeta? La tarjeta guarda la lectura de la
   forma de diccionario (行く いく) y la unidad viene conjugada (行った いった),
   así que se compara la parte que lleva los kanjis: 行った leído おこなった no vale.
   Así se descartan las lecturas equivocadas de kuromoji (今日 こんにち, 角 かく). */
function readingMatches(token, lemma, expected) {
  const reading = scReading(token.reading || ""), want = scReading(expected);
  if (!reading || !want) return false;
  if (token.surface === lemma) return reading === want;
  const chars = [...lemma];
  let last = -1;
  chars.forEach((c, i) => { if (scIsKanji(c) || c === "々") last = i; });
  const head = chars.slice(0, last + 1).join(""), tail = scReading(chars.slice(last + 1).join(""));
  if (!token.surface.startsWith(head)) return false;
  // Sin terminación que conjugar (勉強 + する en una unidad): la lectura empieza igual
  if (!tail) return reading.startsWith(want);
  if (!want.endsWith(tail)) return false;
  const stems = SC_IRREGULAR[lemma] || [want.slice(0, want.length - tail.length)];
  return stems.some((stem) => reading.startsWith(stem));
}

/* A qué palabra corresponde una unidad. Si la escritura tiene varias lecturas
   (角 かど / かく / つの) se elige la que coincide con cómo se lee en la frase.
     sensesOf  escritura -> [{ id, r }] (las palabras del banco con esa escritura)
     fallback  clave a usar si ninguna lectura coincide ("" = sin resolver) */
function resolveKey(token, sensesOf, fallback = "") {
  // Primero la escritura tal cual (誕生日 es 誕生日, no 誕生 + 日); después la forma de diccionario
  for (const form of new Set([token.surface, token.lemma])) {
    const hit = (sensesOf(form) || []).find((word) => readingMatches(token, form, word.r));
    if (hit) return hit.id;
  }
  return fallback;
}

/* Monta la frase a partir de sus unidades ya analizadas.
     tokens     [{ surface, lemma, reading, pos, key }]
     wordOf     key -> { level, kana, studyable } | null: lo que se sabe de una palabra
                (del banco o del diccionario del usuario)
     tagsOf     key -> ["学|がく", …]
     fallbackLevel  nivel para las palabras que no están en el banco */
function buildSentence({ id, tokens, en = "", es = "", source, sourceId = "", attribution = "", wordOf, tagsOf, fallbackLevel = "N5" }) {
  const clean = tokens.map((token) => ({
    surface: token.surface, lemma: token.lemma, reading: token.reading || "", pos: token.pos, key: token.key || ""
  }));
  let level = 0;
  const targets = [], kanjiReadings = [];
  for (const token of clean) {
    if (!scIsContent(token) || !token.key) continue;
    const word = wordOf(token.key);
    level = Math.max(level, SC_LEVELS.indexOf(word?.level || fallbackLevel));
    const [lemma, reading] = scKeyParts(token.key);
    // Se puede preguntar: lleva kanji, no es de las que casi siempre van en kana
    // y la unidad se lee como dice la palabra
    if (!scHasKanji(lemma) || word?.kana || targets.includes(token.key)) continue;
    if (!readingMatches(token, lemma, reading)) continue;
    targets.push(token.key);
    for (const tag of tagsOf(token.key) || []) if (!kanjiReadings.includes(tag)) kanjiReadings.push(tag);
  }
  return {
    id, ja: clean.map((token) => token.surface).join("|"), tokens: clean, en, es,
    source, sourceId, level: SC_LEVELS[level], targets, kanjiReadings, attribution
  };
}

/* Para detectar frases repetidas o casi iguales: sin puntuación ni espacios */
const sentenceFingerprint = (sentence) => sentence.tokens.filter((token) => !scIsPunct(token))
  .map((token) => token.surface).join("").replace(/\s+/g, "");

/* Comprueba una frase. Es la ÚNICA comprobación: la usan la app al sacar frases
   de los textos del usuario y las herramientas con Tatoeba y con la IA; solo
   cambian las opciones.
     text       la frase original sin "|" (si se da, las unidades deben reproducirla)
     minUnits, maxUnits   unidades que no son puntuación
     targets    ids que la frase DEBE servir para preguntar (cada uno con su lectura)
     maxLevel   nivel máximo de las demás palabras (null = cualquiera)
     wordOf     key -> { level } | null
     allowUnresolved  admite palabras con contenido sin resolver
     seen       Set de huellas ya aceptadas: detecta duplicadas (y la añade si es válida)
   Devuelve { ok, reasons }: reasons son códigos, para contar por motivo. */
function validateSentence(sentence, options = {}) {
  const { text, minUnits = 5, maxUnits = 12, targets = [], maxLevel = null, wordOf = () => null,
    allowUnresolved = false, seen = null } = options;
  const reasons = new Set();
  const tokens = sentence.tokens || [];
  if (!tokens.length || tokens.some((token) => !token.surface)) return { ok: false, reasons: ["tokenize"] };

  if (sentence.ja !== tokens.map((token) => token.surface).join("|")) reasons.add("units_mismatch");
  if (text !== undefined && tokens.map((token) => token.surface).join("") !== text) reasons.add("units_mismatch");

  const units = tokens.filter((token) => !scIsPunct(token)).length;
  if (units < minUnits || units > maxUnits) reasons.add("length");

  const joined = tokens.map((token) => token.surface).join("");
  if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(joined)) reasons.add("latin");
  if (/[()（）\[\]［］{}｛｝<>＜＞【】]/.test(joined)) reasons.add("brackets"); // restos de 角(かど) o de etiquetas
  // Comillas japonesas: valen si están emparejadas
  if ((joined.match(/[「『]/g) || []).length !== (joined.match(/[」』]/g) || []).length) reasons.add("brackets");

  for (const token of tokens) {
    if (!scIsContent(token)) continue;
    if (!token.key) { if (!allowUnresolved) reasons.add("unresolved"); continue; }
    if (targets.includes(token.key)) continue;
    const info = wordOf(token.key);
    if (info?.kana) continue; // casi siempre en kana (する = 為る, N3 en las listas): no cuenta para el nivel
    const level = info?.level;
    // Una palabra de fuera del banco no tiene nivel: con límite de nivel no se admite
    if (maxLevel && (!level ? scHasKanji(scKeyParts(token.key)[0]) : SC_LEVELS.indexOf(level) > SC_LEVELS.indexOf(maxLevel))) {
      reasons.add("level");
    }
  }

  // Cada palabra pedida tiene que estar y leerse como se espera
  for (const target of targets) {
    const [lemma, reading] = scKeyParts(target);
    const found = tokens.filter((token) => token.lemma === lemma || token.key === target);
    if (!found.length) reasons.add("target_missing");
    else if (!found.some((token) => readingMatches(token, lemma, reading))) reasons.add("reading_mismatch");
  }
  if (!targets.length && !(sentence.targets || []).length) reasons.add("no_target");

  if (seen) {
    const print = sentenceFingerprint(sentence);
    if (seen.has(print)) reasons.add("duplicate");
    else if (!reasons.size) seen.add(print);
  }
  return { ok: reasons.size === 0, reasons: [...reasons] };
}

/* =========================================
   3. QUÉ FRASE SE ENSEÑA AL REPASAR UNA PALABRA
   -----------------------------------------
   La regla "i+1": la palabra de la tarjeta dentro de una frase en la que todo
   lo demás ya se conoce. Como mucho se admite UNA palabra más sin conocer (se
   enseña con furigana y se puede tocar); con dos o más la frase se descarta.
   ========================================= */

const SOURCE_ORDER = { text: 0, article: 0, tatoeba: 1, ai: 2 };

/* card       { id: "escritura|lectura" }
   state      { candidates  frases posibles (cualquiera; aquí se filtran)
                isKnown     key -> ¿el usuario conoce esa palabra?
                statsOf     id de frase -> { shown, lastShown } | undefined }
   Devuelve { sentence, target, extra } (índices de la unidad preguntada y de
   la palabra desconocida de más, -1 si no hay) o null: entonces se enseña la
   palabra sola, como siempre. */
function chooseSentence(card, state) {
  const [lemma, reading] = scKeyParts(card.id);
  const usable = [];
  for (const sentence of state.candidates || []) {
    if (!(sentence.targets || []).includes(card.id)) continue;
    // La unidad tiene que leerse como espera la tarjeta: se comprueba otra vez aquí
    const target = sentence.tokens.findIndex((token) => token.key === card.id && readingMatches(token, lemma, reading));
    if (target < 0) continue;
    const item = scUsable({ sentence, target }, card.id, state);
    if (item) usable.push(item);
  }
  const best = scBest(usable);
  return best && { sentence: best.sentence, target: best.target, extra: best.extra };
}

/* Un kanji suelto: se pregunta cómo suena dentro de una palabra de la frase.
   state.candidates: [{ sentence, target, char, sound, sounds, tag }] (la unidad,
   el carácter dentro de ella, cómo suena, el reparto de kanjiSounds y su
   etiqueta "kanji|lectura"). La palabra que lo lleva cuenta como una más: si no
   la conoce es la desconocida de más, pero no se puede tocar (enseñaría la
   respuesta). Devuelve el candidato elegido con su extra, o null. */
function chooseKanjiSentence(state) {
  const usable = (state.candidates || []).map((candidate) => scUsable(candidate, null, state)).filter(Boolean);
  const best = scBest(usable);
  if (!best) return null;
  const { shown, lastShown, ...pick } = best;
  return { ...pick, extra: pick.extra === pick.target ? -1 : pick.extra };
}

/* La frase sirve si, quitando la palabra preguntada (skip), le queda como mucho
   una palabra sin conocer. Devuelve el candidato con extra y sus contadores, o null. */
function scUsable(candidate, skip, state) {
  const unknown = new Map(); // clave -> índice de su primera unidad
  candidate.sentence.tokens.forEach((token, index) => {
    if (!scIsContent(token) || skip && token.key === skip) return;
    const key = token.key || `?${token.surface}`; // sin resolver: no se puede saber si la conoce
    if (!unknown.has(key) && !(token.key && state.isKnown(token.key))) unknown.set(key, index);
  });
  if (unknown.size > 1) return null;
  const stats = state.statsOf?.(candidate.sentence.id) || {};
  return { ...candidate, extra: unknown.size ? [...unknown.values()][0] : -1,
    shown: stats.shown || 0, lastShown: stats.lastShown || 0 };
}

/* Una frase que el usuario guardó de la web para esta palabra (source "web",
   word = la palabra). Manda sobre las demás y no sigue la regla i+1: la eligió
   él y recordar dónde la encontró ayuda a recordar la palabra. Solo hace falta
   que la palabra esté y se lea como la tarjeta. Entre varias, la que hace más
   que no sale. Devuelve { sentence, target, extra: -1, captured: true } o null. */
function chooseCapturedSentence(card, state) {
  const [lemma, reading] = scKeyParts(card.id);
  const usable = [];
  for (const sentence of state.candidates || []) {
    if (sentence.source !== "web" || sentence.word !== card.id) continue;
    const target = sentence.tokens.findIndex((token) => token.key === card.id && readingMatches(token, lemma, reading));
    if (target >= 0) usable.push({ sentence, target, lastShown: state.statsOf?.(sentence.id)?.lastShown || 0 });
  }
  usable.sort((a, b) => a.lastShown - b.lastShown || (a.sentence.id < b.sentence.id ? -1 : 1));
  return usable.length ? { sentence: usable[0].sentence, target: usable[0].target, extra: -1, captured: true } : null;
}

/* La mejor de las frases que sirven, o null */
function scBest(usable) {
  if (!usable.length) return null;
  // La última que se enseñó para esta palabra se evita si hay otra
  const latest = Math.max(...usable.map((item) => item.lastShown));
  const others = usable.some((item) => item.lastShown !== latest);
  const score = (item) =>
    (item.extra >= 0 ? 1000 : 0) +
    (others && latest > 0 && item.lastShown === latest ? 500 : 0) +
    (SOURCE_ORDER[item.sentence.source] ?? 3) * 20 +   // primero las de sus textos, luego Tatoeba, luego IA
    Math.min(item.shown, 20) * 8;                      // …salvo que ya la haya visto muchas veces
  return [...usable].sort((a, b) => score(a) - score(b) || a.lastShown - b.lastShown ||
    (a.sentence.id < b.sentence.id ? -1 : a.sentence.id > b.sentence.id ? 1 : 0))[0];
}

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    kanjiVariants, canonicalReading, alignReading, tagsFromFurigana, packTags, unpackTags, kanjiSounds,
    readingMatches, resolveKey, buildSentence, validateSentence, sentenceFingerprint, chooseSentence, chooseKanjiSentence,
    chooseCapturedSentence
  };
}
