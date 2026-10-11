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

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = {
    isKana, PUNCTUATION, KUROMOJI_POS, PARTICLES, piecePos, isContentPiece, pieceBase, pieceReading,
    unitOf, analyseUnits
  };
}
