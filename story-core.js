/* =========================================
   KANJI LEARNING APP - story-core.js
   Textos que practican lo que toca repasar y que no se repiten. Sin navegador
   ni datos del usuario alrededor, para poder probarlo con Node. Se carga
   después de ranking-core.js; lo usa reading.js (promptParams y
   generateAndOpen).

   1. Palabras objetivo: las que tocan o van a tocar pronto se le piden a la
      IA; luego se comprueba cuáles salen de verdad en el texto.
   2. Variedad: tipo de texto, tema y personajes van rotando.
   3. Parecido: un texto que repite frases de los últimos se vuelve a pedir.
   4. Listas limpias: las palabras que se mandan a la IA, sin formas
      conjugadas, trozos ni grafías raras, y cada una en una sola lista.
   5. Escenas gastadas: lo que sale en muchos de los últimos textos.
   Los números vienen de STUDY_CONFIG.stories.
   ========================================= */

const STC_DAY = 86400000;
const stcAddDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * STC_DAY).toISOString().slice(0, 10);

/* =========================================
   1. PALABRAS OBJETIVO
   ========================================= */

/* Lo que se le pide a la IA que use.
     words     [{ id, label, nextReview, studied }]: las palabras del usuario (label: cómo
               se le escribe a la IA, 角(かど))
     kanjiDue  [{ c, nextReview, word: { id, label } | null }]: kanjis cuya tarjeta toca,
               con una palabra que conoce que lo lleva
     day       hoy
     config    { max, soonDays }
   Devuelve [{ id, label, due }]: primero las que tocan (la más atrasada antes),
   después las que tocarán en soonDays días y, si queda sitio, una palabra por
   cada kanji que toca. Sin repetir palabras. */
function storyTargets(words, kanjiDue, day, config) {
  const soon = stcAddDays(day, config.soonDays);
  const byDate = (a, b) => a.nextReview.localeCompare(b.nextReview) || a.id.localeCompare(b.id);
  const studied = words.filter((word) => word.studied && word.nextReview && word.nextReview <= soon).sort(byDate);
  const out = [], seen = new Set();
  const add = (id, label, due) => {
    if (out.length >= config.max || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, due });
  };
  for (const word of studied.filter((w) => w.nextReview <= day)) add(word.id, word.label, true);
  for (const word of studied.filter((w) => w.nextReview > day)) add(word.id, word.label, false);
  for (const kanji of [...kanjiDue].filter((k) => k.word && k.nextReview <= day).sort((a, b) => a.nextReview.localeCompare(b.nextReview))) {
    add(kanji.word.id, kanji.word.label, true);
  }
  return out;
}

/* Cuáles de las pedidas salen en el texto.  lemmas: las claves del texto ({ "名前|なまえ": veces }) */
function targetsFound(targets, lemmas) {
  return targets.filter((target) => lemmas[target.id]).map((target) => target.id);
}

/* =========================================
   2. VARIEDAD
   ========================================= */

/* Lo que toca ahora: el tipo y el tema que hace más que no salen (o nunca), y
   `castSize` personajes de los menos usados.
     history  [{ type, topic, cast: [índices] }] de los últimos textos, el más reciente primero
     types, topics  las listas posibles;  castCount  cuántos personajes hay
   Devuelve { type, topic, cast } */
function nextVariety(history, types, topics, castCount, castSize = 2) {
  const age = (value, key) => {
    const i = history.findIndex((item) => key(item) === value);
    return i < 0 ? Infinity : i;
  };
  const oldest = (list, key) => [...list].sort((a, b) => age(b, key) - age(a, key) || list.indexOf(a) - list.indexOf(b))[0];
  const uses = new Map(Array.from({ length: castCount }, (_, i) => [i, 0]));
  history.forEach((item, position) => {
    // Lo reciente pesa más: los de los últimos textos son los que más se repetirían
    for (const i of item.cast || []) if (uses.has(i)) uses.set(i, uses.get(i) + 1 / (position + 1));
  });
  const cast = [...uses].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, castSize).map(([i]) => i).sort((a, b) => a - b);
  return { type: oldest(types, (item) => item.type), topic: oldest(topics, (item) => item.topic), cast };
}

/* =========================================
   3. PARECIDO CON LOS ÚLTIMOS TEXTOS
   -----------------------------------------
   Por frases, no por palabras sueltas: que salgan ています o ました en todos
   los textos es normal; que salga otra vez 「お腹が空きました」 no. Una frase
   se repite si coincide casi entera (trigramas de caracteres, Jaccard) con
   una frase de los últimos textos.
   ========================================= */

/* Una frase sin puntuación ni espacios */
const stcClean = (sentence) => String(sentence).replace(/[\s|、。！？!?「」『』（）()・…ー〜,.]/g, "");

function stcTrigrams(text) {
  const chars = [...text], grams = new Set();
  for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(""));
  return grams;
}

const stcJaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const gram of a) if (b.has(gram)) common++;
  return common / (a.size + b.size - common);
};

/* sentences: las frases del texto nuevo; recent: las de los últimos textos.
   config: { sentenceMatch, maxShare, maxRepeated }
   Devuelve { repeated: [frases del texto nuevo que ya salieron], share, tooSimilar } */
function textSimilarity(sentences, recent, config) {
  const old = recent.map(stcClean).filter((text) => [...text].length >= 4)
    .map((text) => ({ text, grams: stcTrigrams(text) }));
  const repeated = [];
  let counted = 0;
  for (const sentence of sentences) {
    const text = stcClean(sentence);
    if ([...text].length < 4) continue; // 「はい。」 no dice nada
    counted++;
    const grams = stcTrigrams(text);
    if (old.some((item) => item.text === text || stcJaccard(grams, item.grams) >= config.sentenceMatch)) repeated.push(sentence);
  }
  const share = counted ? repeated.length / counted : 0;
  return { repeated, share, tooSimilar: repeated.length >= config.maxRepeated || share >= config.maxShare };
}

/* =========================================
   4. LISTAS LIMPIAS PARA LA IA
   -----------------------------------------
   Al leer, la app guardaba a veces lo que aparecía en el texto tal cual:
   formas conjugadas (いました, 来て), trozos (のは, んだ) o palabras con una
   lectura inventada (下手|したて, siempre «por repasar»). Mandadas a la IA,
   le piden usar cosas que no son palabras. Antes de escribir el prompt,
   cada palabra pasa por promptWord y las tres listas por cleanWordLists.
   ========================================= */

// <listas-limpias> (generate-text lleva una copia: node tools/sync-prompt.mjs)
/* Grafías que el banco no marca pero que se escriben así (御飯 -> ご飯) */
const SC_SPELLING = [[/御飯/g, "ご飯"], [/^綺麗$/, "きれい"]];

/* Okurigana antiguo de las listas JLPT -> el de hoy (落す -> 落とす). Revisada a mano
   entre las palabras del banco con un alias que solo añade kana: las que ya son la
   forma normal (行う, 話, 受付, 割合, 葉書…) no están. La usa también la migración. */
const SC_MODERN = {
  落す: "落とす", 落る: "落ちる", 終る: "終わる", 楽む: "楽しむ", 曲る: "曲がる", 下る: "下がる",
  浮ぶ: "浮かぶ", 交す: "交わす", 代る: "代わる", 代る代る: "代わる代わる", 付合う: "付き合う",
  振舞う: "振る舞う", 捕える: "捕らえる", 損う: "損なう", 吊す: "吊るす", 割込む: "割り込む",
  引下げる: "引き下げる", 引取る: "引き取る", 引受る: "引き受ける", 落着く: "落ち着く",
  落し物: "落とし物", 人差指: "人差し指", 支払: "支払い", 答: "答え", 祭: "祭り", 釣: "釣り",
  年寄: "年寄り", 当り: "当たり", 打合せ: "打ち合わせ", 戸締り: "戸締まり", 取締り: "取り締まり",
  夜更し: "夜更かし", 目覚し: "目覚まし", 目覚しい: "目覚ましい", 情深い: "情け深い",
  受持ち: "受け持ち", 組合せ: "組み合わせ", 書取: "書き取り", 割算: "割り算", 引算: "引き算",
  焚火: "焚き火", 仕組: "仕組み", 仕掛: "仕掛け", 箇条書: "箇条書き", 雛祭: "雛祭り",
  目盛: "目盛り", 月並: "月並み", 軒並: "軒並み", 俄: "俄か", 賭: "賭け", 届: "届け"
};

const scKanaOnly = (text) => /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(text);
// Lo que se pega detrás de un verbo o adjetivo al conjugarlo (ました, て, た, な…)
const scEnding = (token) => token.pos === "助動詞" || token.pos === "助詞" && token.detail === "接続助詞";

/* Una palabra, lista para el prompt, o por qué no va.
     item   { lemma, reading, status } (o solo la escritura, como texto)
     tools  { tokens(texto) -> [{ surface, pos, detail, base }] (kuromoji) o null,
              inBank(lemma, reading) -> si es una palabra del banco (esas ya son forma
              de diccionario: 嫌い o 曇り no se «desconjugan»),
              hasMeaning(lemma, reading) -> si el banco o el diccionario propio le dan
              significado, label(lemma, reading) -> cómo se le escribe a la IA }
   Sin tokens (la Edge Function no tiene kuromoji) solo se aplican las reglas
   que no lo necesitan. Devuelve { lemma, reading, label, changed } o { drop: motivo }. */
function promptWord(item, tools = {}) {
  const source = typeof item === "string" ? { lemma: item } : item;
  let lemma = String(source.lemma || "").normalize("NFKC"), reading = source.reading;
  if (!lemma) return { drop: "vacía" };
  if ([...lemma].length === 1 && scKanaOnly(lemma)) return { drop: "kana suelta" }; // い
  const inBank = tools.inBank ? tools.inBank(lemma, reading) : false;
  const tokens = tools.tokens && !inBank ? tools.tokens(lemma) : null;
  let changed = "";
  if (tokens) {
    const [first, ...rest] = tokens;
    if (!first) return { drop: "vacía" };
    // Un trozo: empieza por partícula o auxiliar, o por algo que no va solo y sigue (のは, んだ);
    // こと o ため solas sí son palabras
    if (["助詞", "助動詞"].includes(first.pos) || rest.length && first.pos === "名詞" && first.detail === "非自立") return { drop: "trozo" };
    const base = first.base && first.base !== "*" ? first.base : first.surface;
    if (rest.length && rest.every(scEnding)) {
      // Conjugada: 来て -> 来る, いました -> いる, 有名な -> 有名
      [lemma, reading, changed] = [base, undefined, "conjugada"];
    } else if (!rest.length && ["動詞", "形容詞"].includes(first.pos) && base !== lemma && !scKanaOnly(lemma)) {
      // Cortada o en otra forma: 聞こえ -> 聞こえる, 速く -> 速い (en kana no: たち no es たつ)
      [lemma, reading, changed] = [base, undefined, "forma"];
    }
    // Dos kana que nunca estudió y que suenan a verbo: casi siempre un trozo (ける de 続ける)
    if (!changed && first.pos === "動詞" && scKanaOnly(lemma) && [...lemma].length <= 2 && source.status === "pre_known") {
      return { drop: "trozo probable" };
    }
    if (changed && [...lemma].length === 1 && scKanaOnly(lemma)) return { drop: "kana suelta" };
  }
  if (tools.hasMeaning && !tools.hasMeaning(lemma, reading)) return { drop: "sin significado" };
  let label = tools.label ? tools.label(lemma, reading) : lemma;
  for (const [pattern, spelling] of SC_SPELLING) label = label.replace(pattern, spelling);
  label = label.replace(/^[^(]+/, (writing) => SC_MODERN[writing] || writing); // 落す(おとす) -> 落とす(おとす)
  return { lemma, reading, label, changed };
}

/* Las tres listas del prompt, limpias y sin repetirse entre ellas: una palabra
   que toca repasar no va también como «aprendiendo» ni como «conocida», y una
   que está aprendiendo no va como conocida. Cada lista conserva su orden.
     lists  { known, learning, targets }: palabras como las recibe promptWord
            (las de targets pueden traer id: se conserva para comprobar después)
   Devuelve { known, learning, targets: [{ id, label }], removed: [{ list, word, reason }],
   changed: [{ list, from, to }] } */
function cleanWordLists(lists, tools = {}) {
  const used = new Set();
  const out = { known: [], learning: [], targets: [], removed: [], changed: [] };
  for (const list of ["targets", "learning", "known"]) {
    for (const item of lists[list] || []) {
      const word = typeof item === "string" ? item : item.label || item.lemma;
      const result = promptWord(item, tools);
      if (result.drop) { out.removed.push({ list, word, reason: result.drop }); continue; }
      if (used.has(result.label)) continue; // ya va en esta lista o en una más importante
      used.add(result.label);
      if (result.label !== word) out.changed.push({ list, from: word, to: result.label });
      out[list].push(list === "targets" ? { id: item.id, label: result.label } : result.label);
    }
  }
  return out;
}
// </listas-limpias>

/* =========================================
   5. ESCENAS GASTADAS
   -----------------------------------------
   Aunque cambien tipo y tema, los textos acaban girando alrededor de lo
   mismo (コーヒー, 駅, 雨…). Lo que sale en muchos de los últimos textos se le
   pide a la IA que no lo use como centro de la historia.
   ========================================= */

/* sessions  sesiones de lectura terminadas [{ textId, finishedAt, discarded }]
   lemmasOf  textId -> { "駅|えき": veces } del texto (o null si ya no está)
   config    { recent, minTexts, max }; skip(clave) -> true para lo que no cuenta
             (palabras muy comunes, las que toca repasar)
   Devuelve las escrituras más repetidas: ["コーヒー", "駅"] */
function overusedScenes(sessions, lemmasOf, config, skip = () => false) {
  const recent = [...sessions].filter((session) => !session.discarded)
    .sort((a, b) => b.finishedAt - a.finishedAt).slice(0, config.recent);
  const texts = new Map(); // un texto leído dos veces cuenta una
  for (const session of recent) texts.set(session.textId, lemmasOf(session.textId));
  const count = new Map();
  for (const lemmas of texts.values()) {
    for (const key of Object.keys(lemmas || {})) {
      const writing = key.split("|")[0];
      // Solo lo que puede ser escena u objeto: con kanji o katakana, no frases ni partículas
      if (skip(key) || !/[\p{Script=Han}\p{Script=Katakana}]/u.test(writing)) continue;
      count.set(writing, (count.get(writing) || 0) + 1);
    }
  }
  return [...count].filter(([, n]) => n >= config.minTexts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, config.max).map(([writing]) => writing);
}

/* Para las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { storyTargets, targetsFound, nextVariety, textSimilarity, promptWord, cleanWordLists, overusedScenes, SC_MODERN };
}
