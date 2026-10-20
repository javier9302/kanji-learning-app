/* =========================================
   KANJI LEARNING APP - ja-core.js
   Análisis del japonés sin nada de la app alrededor: reparte las piezas de
   kuromoji entre las unidades de una oración y divide un texto en oraciones.
   No toca el DOM ni los datos del usuario, así que lo usan igual el navegador
   (se carga antes de reading.js) y las herramientas de tools/ con Node.
   ========================================= */

const isKana = (value) => /^[぀-ヿー]+$/.test(value);
const PUNCTUATION = /^[\s\p{P}\p{S}]+$/u;

const KUROMOJI_POS = {
  "動詞": "verb", "形容詞": "i_adjective", "副詞": "adverb", "助詞": "particle", "助動詞": "auxiliary",
  "接続詞": "conjunction", "感動詞": "interjection", "連体詞": "determiner", "接頭詞": "prefix",
  "記号": "symbol", "フィラー": "interjection"
};
const NOUN_DETAIL = { "固有名詞": "proper_noun", "数": "number", "代名詞": "pronoun", "形容動詞語幹": "na_adjective", "接尾": "suffix" };
const piecePos = (piece) => piece.pos === "名詞" ? NOUN_DETAIL[piece.pos_detail_1] || "noun" : KUROMOJI_POS[piece.pos] || "expression";
/* Piezas con contenido: de ellas sale el lema de la unidad */
const isContentPiece = (piece) => ["動詞", "形容詞", "名詞", "副詞", "連体詞", "感動詞", "接続詞"].includes(piece.pos) &&
  piece.pos_detail_1 !== "非自立" && piece.pos_detail_1 !== "接尾";
const pieceBase = (piece) => piece.basic_form && piece.basic_form !== "*" ? piece.basic_form : piece.surface_form;
const pieceReading = (piece) => piece.reading && piece.reading !== "*"
  ? piece.reading.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  : isKana(piece.surface_form) ? piece.surface_form : null;

/* Partículas habituales: una unidad que sea exactamente una de estas lo es siempre */
const PARTICLES = new Set(("は が を に で も と の か ね よ へ や な わ ぞ さ し ば て から まで より など って けど ので のに " +
  "でも だけ しか ばかり くらい ぐらい ほど こそ さえ かな よね とか には では にも とは へは").split(" "));

/* Analiza unas piezas seguidas como una sola unidad */
function unitOf(pieces) {
  const surface = pieces.map((piece) => piece.surface_form).join("");
  const content = pieces.find(isContentPiece) || pieces[0];
  const readings = pieces.map(pieceReading);
  const katakana = /^[ァ-ヶー]+$/.test(surface);
  return {
    surface, pieces,
    punct: PUNCTUATION.test(surface),
    pos: PUNCTUATION.test(surface) ? "punctuation" : PARTICLES.has(surface) ? "particle" : piecePos(content),
    basic: pieces.length === 1 || isContentPiece(pieces[0]) || pieces.some(isContentPiece) ? pieceBase(content) : surface,
    // Lectura de la unidad tal como está escrita (para el furigana); "" si kuromoji no la conoce
    reading: katakana ? surface : readings.every((r) => r !== null) ? readings.join("") : "",
    // Conjugación que da kuromoji: no se muestra todavía, se guarda para más adelante
    morph: pieces.map((piece) => [piece.surface_form, piece.pos, piece.conjugated_type, piece.conjugated_form, pieceBase(piece)])
  };
}

/* Una oración segmentada con "|" -> sus unidades analizadas.
   kuromoji acierta más con la oración entera que con cada unidad suelta, así
   que se analiza la oración y sus piezas se reparten entre las unidades.
   Si una pieza cae entre dos unidades, esas se analizan por separado. */
function analyseUnits(tokenizer, ja) {
  const units = ja.split("|").map((unit) => unit.trim());
  const pieces = tokenizer.tokenize(units.join(""));
  const grouped = units.map(() => []);
  let unit = 0, unitEnd = units[0].length, offset = 0, clean = units.map(() => true);
  for (const piece of pieces) {
    const end = offset + piece.surface_form.length;
    while (unit < units.length - 1 && offset >= unitEnd) unitEnd += units[++unit].length;
    if (end > unitEnd) { // cruza la frontera: las unidades que toca se analizarán solas
      clean[unit] = false;
      for (let next = unit + 1, reach = unitEnd; next < units.length && reach < end; next++) {
        clean[next] = false;
        reach += units[next].length;
      }
    }
    grouped[unit].push(piece);
    offset = end;
  }
  return units.map((text, i) => unitOf(clean[i] && grouped[i].length ? grouped[i] : tokenizer.tokenize(text)));
}

/* =========================================
   UNA PALABRA ESCRITA EN KANA
   -----------------------------------------
   En un texto llega en kana (いる, なる, いう) y en el banco está con kanji.
   Varias palabras pueden leerse igual: いる es 居る "estar", pero también
   要る "necesitar", 炒る "tostar"… Elegir la primera que coincide daba
   significados equivocados. Reglas:
     1. una palabra del banco que casi siempre se escribe en kana (有る -> ある)
        es esa palabra;
     2. si no, manda el diccionario general (JMdict), que sabe qué palabra se
        escribe normalmente así;
     3. solo si no la tiene y en el banco hay UNA sola palabra con esa lectura
        (いう -> 言う), es esa;
     4. si hay varias, no se adivina: queda sin resolver.
   candidates: las palabras del banco con esa lectura.
   ========================================= */

/* Regla 1 */
const kanaFormWord = (candidates) => (candidates || []).find((word) => word.kana) || null;
/* Regla 3: la única palabra del banco que se lee así (o null si hay varias o ninguna) */
const onlyHomophone = (candidates) => (candidates || []).length === 1 ? candidates[0] : null;

/* =========================================
   TEXTO SIN SEGMENTAR (un artículo pegado tal cual)
   ========================================= */

const SENTENCE_END = "。！？!?";
const QUOTE_OPEN = "「『（(", QUOTE_CLOSE = "」』）)";

/* Divide un texto en oraciones: [{ p: párrafo, text }]. Una oración acaba en
   。！？ (y las comillas de cierre que la sigan). Dentro de unas comillas no
   se corta: 「行きます。」と言った。 es una sola oración; dos citas seguidas,
   「おはよう。」「元気？」, son dos. Cada línea es un párrafo. */
function splitSentences(text) {
  const list = [];
  String(text).normalize("NFC").split(/\r?\n/).forEach((line) => {
    const chars = [...line.trim()];
    if (!chars.length) return;
    const p = (list[list.length - 1]?.p || 0) + (list.length && list[list.length - 1].line === line ? 0 : 1);
    let current = "", depth = 0;
    const push = () => {
      if (current.trim()) list.push({ p, text: current.trim(), line });
      current = "";
    };
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i], next = chars[i + 1];
      current += c;
      if (QUOTE_OPEN.includes(c)) depth++;
      else if (QUOTE_CLOSE.includes(c)) {
        depth = Math.max(0, depth - 1);
        // La cita terminó con su propio punto y detrás empieza otra (o nada): fin de oración
        if (!depth && SENTENCE_END.includes(chars[i - 1]) && (next === undefined || QUOTE_OPEN.includes(next))) push();
      } else if (SENTENCE_END.includes(c) && !depth && !SENTENCE_END.includes(next) && !QUOTE_CLOSE.includes(next)) push();
    }
    push();
  });
  return list.map(({ p, text: sentence }) => ({ p, text: sentence }));
}

/* Agrupa las piezas de kuromoji en las unidades que usa la app, con las mismas
   reglas que se le piden a la IA: un verbo o adjetivo conjugado va entero con
   sus terminaciones (食べています, 高くなかった), las partículas van sueltas y
   です / だ tras un nombre o adjetivo también. Devuelve listas de piezas. */
function groupPieces(pieces) {
  const units = [];
  const isInflected = (piece) => piece.pos === "動詞" || piece.pos === "形容詞";
  for (const piece of pieces) {
    if (!piece.surface_form.trim()) continue; // espacios
    const unit = units[units.length - 1], last = unit?.[unit.length - 1];
    const copula = piece.pos === "助動詞" && ["です", "だ"].includes(pieceBase(piece));
    // La unidad es un verbo o adjetivo con sus terminaciones, o un です / だ conjugado (でし+た)
    const chain = unit && (isInflected(unit[0]) || unit[0].pos === "助動詞");
    let join = false;
    if (last && PUNCTUATION.test(last.surface_form) || PUNCTUATION.test(piece.surface_form)) join = false;
    // です / だ van sueltos (高い|です, おいしくなかった|です) salvo tras ません: 食べません+でした
    else if (chain && piece.pos === "助動詞") join = !copula || last.surface_form === "ん";
    else if (chain && piece.pos === "助詞" && piece.pos_detail_1 === "接続助詞" && ["て", "で", "ちゃ", "じゃ"].includes(piece.surface_form)) join = true;
    else if (chain && isInflected(piece) && ["非自立", "接尾"].includes(piece.pos_detail_1)) join = true; // ている, られる, やすい
    else if (last?.pos === "接頭詞") join = true;                                                          // お|茶 -> お茶
    else if (last?.pos === "名詞" && last.pos_detail_1 === "数" && piece.pos === "名詞" &&
      (piece.pos_detail_1 === "数" || piece.pos_detail_1 === "接尾" && piece.pos_detail_2 === "助数詞")) join = true; // 三|人 -> 三人
    if (join) unit.push(piece);
    else units.push([piece]);
  }
  return units;
}

/* Una oración sin segmentar -> la misma con "|" entre unidades */
const segmentSentence = (tokenizer, text) =>
  groupPieces(tokenizer.tokenize(String(text).replace(/\|/g, "｜"))).map((unit) => unit.map((piece) => piece.surface_form).join("")).join("|");

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    isKana, PUNCTUATION, KUROMOJI_POS, PARTICLES, piecePos, isContentPiece, pieceBase, pieceReading,
    unitOf, analyseUnits, splitSentences, groupPieces, segmentSentence, kanaFormWord, onlyHomophone
  };
}
