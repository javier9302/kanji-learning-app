/* =========================================
   KANJI LEARNING APP - capture-core.js
   Palabras que llegan de la web (etapa 3): por un enlace
   (?add=palabra&sentence=frase&source=página), por el marcador «+ Kanji» o
   por «Compartir» de Android (?share_text=…). Reglas puras, sin DOM: qué se
   acepta de la dirección, la frase alrededor de lo seleccionado, qué unidad
   de la frase es la palabra y el código del marcador. Lo que toca la pantalla
   está en capture.js.
   Todo lo que llega es de fuera: se limpia y se acorta aquí, y en pantalla
   se escribe siempre con textContent o escapeHTML.
   ========================================= */

const CAPTURE_LIMITS = { word: 30, sentence: 300, source: 2000 };
const CAPTURE_JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// Fin de oración (también el de las comillas) y salto de línea
const CAPTURE_END = "。！？!?\n";
const CAPTURE_CLOSE = "」』）)";

// Caracteres de control e invisibles (espacios de ancho cero, separadores de línea Unicode, BOM)
const CAPTURE_INVISIBLE = new RegExp(`[${[[0, 8], [11, 31], [127, 127], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]]
  .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`, "g");

/* Texto de fuera, limpio: sin caracteres de control, espacios seguidos ni más de max caracteres */
function cleanCaptured(value, max) {
  return [...String(value ?? "").normalize("NFC").replace(CAPTURE_INVISIBLE, "")
    .replace(/[ \t\r\n　]+/g, " ").trim()].slice(0, max).join("");
}

/* La página de origen, solo si es una dirección web normal (http o https); si no, "" */
function safeSourceUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > CAPTURE_LIMITS.source) return "";
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/* ¿Lo seleccionado es una palabra o ya una frase? Una frase lleva puntuación,
   espacios o es larga (日本語を勉強しています). Lo que no lleva japonés no vale. */
const looksLikeWord = (text) => !!text && [...text].length <= 15 && !/[\s。、！？!?,.「」『』]/.test(text);

/* Quita las comillas con las que algunos navegadores comparten la selección ("…", “…”, 「…」) */
const unquote = (text) => {
  const pairs = { '"': '"', "“": "”", "「": "」", "『": "』", "'": "'" };
  const chars = [...text];
  return chars.length > 1 && pairs[chars[0]] === chars[chars.length - 1] ? chars.slice(1, -1).join("").trim() : text;
};

/* Lo que trae la dirección al abrir la app, o null si no trae nada que agregar.
   Devuelve { word, sentence, source }: word "" = hay que elegirla en la frase;
   sentence "" = sin frase. La frase solo se conserva si contiene la palabra. */
function readCapture(search) {
  const params = new URLSearchParams(search || "");
  let word = "", sentence = "", source = "";
  if (params.has("add") || params.has("sentence")) {
    word = cleanCaptured(params.get("add"), 200);
    sentence = cleanCaptured(params.get("sentence"), CAPTURE_LIMITS.sentence);
    source = safeSourceUrl(params.get("source"));
  } else if (params.has("share_text") || params.has("share_title") || params.has("share_url")) {
    // Android: el texto compartido a veces trae la página dentro, al final
    let text = String(params.get("share_text") || "");
    const urls = text.match(/https?:\/\/[^\s"”」]+/g) || [];
    for (const url of urls) text = text.replace(url, " ");
    text = unquote(cleanCaptured(text, 1000));
    if (!CAPTURE_JAPANESE.test(text)) text = unquote(cleanCaptured(params.get("share_title"), 1000));
    source = safeSourceUrl(params.get("share_url")) || safeSourceUrl(urls[0]);
    if (looksLikeWord(text)) word = text;
    else sentence = cleanCaptured(text, CAPTURE_LIMITS.sentence);
  } else {
    return null;
  }
  // Seleccionó una frase entera: se elige la palabra dentro de ella
  if (word && !looksLikeWord(word)) {
    if (!sentence) sentence = cleanCaptured(word, CAPTURE_LIMITS.sentence);
    word = "";
  }
  if (word && !CAPTURE_JAPANESE.test(word)) word = "";
  if (sentence && (!CAPTURE_JAPANESE.test(sentence) || word && !sentence.includes(word))) sentence = "";
  if (!word && !sentence) return null;
  return { word: [...word].slice(0, CAPTURE_LIMITS.word).join(""), sentence, source };
}

/* La oración de text que contiene lo seleccionado (de start a end): desde el
   fin de la anterior hasta su 。！？ (con las comillas de cierre que lo sigan)
   o el salto de línea. Si sale demasiado larga, se recorta alrededor de la
   selección. Se usa dentro del marcador: no puede llamar a nada de fuera
   (ni comentarios de línea: el código va en una sola dirección). */
function sentenceAround(text, start, end) {
  var END = "。！？!?\n", CLOSE = "」』）)", MAX = 300;
  text = String(text || "");
  start = Math.max(0, Math.min(start, text.length));
  end = Math.max(start, Math.min(end, text.length));
  var from = start;
  while (from > 0 && END.indexOf(text.charAt(from - 1)) < 0) from--;
  var to = end;
  while (to < text.length && END.indexOf(text.charAt(to)) < 0) to++;
  if (to < text.length && text.charAt(to) !== "\n") to++;
  while (to < text.length && CLOSE.indexOf(text.charAt(to)) >= 0) to++;
  if (to - from > MAX) {
    var half = Math.floor((MAX - (end - start)) / 2);
    from = Math.max(from, start - Math.max(0, half));
    to = Math.min(to, from + MAX);
  }
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

/* Qué unidad de la frase es la palabra elegida: la que más se solapa con ella
   (a igualdad, la primera). Las partículas y la puntuación no cuentan. tokens:
   las unidades analizadas ({ surface, pos }); at: dónde empieza la palabra en
   la frase (si no se sabe, su primera aparición). Devuelve el índice o -1. */
function findWordUnit(tokens, word, at = -1, skipPos = new Set(["particle", "auxiliary", "punctuation", "symbol"])) {
  const joined = tokens.map((token) => token.surface).join("");
  const start = at >= 0 ? at : joined.indexOf(word);
  if (!word || start < 0) return -1;
  const end = start + word.length;
  let best = -1, bestOverlap = 0, offset = 0;
  tokens.forEach((token, index) => {
    const from = offset, to = offset + token.surface.length;
    offset = to;
    if (skipPos.has(token.pos)) return;
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > bestOverlap) { best = index; bestOverlap = overlap; }
  });
  return best;
}

/* Lo que hace el marcador en la página: la selección, la oración alrededor
   (sentenceAround) y la dirección, y abre la app con ellas. around: la función
   sentenceAround; message: el aviso si no hay nada seleccionado. Sin
   comentarios de línea ni nada de fuera, como sentenceAround. */
function bookmarkletMain(app, around, message) {
  var selection = window.getSelection();
  var picked = String(selection || "").replace(/\s+/g, " ").trim();
  if (!picked) { alert(message); return; }
  var sentence = "";
  try {
    var range = selection.getRangeAt(0);
    var node = range.startContainer;
    var block = node.nodeType === 1 ? node : node.parentElement;
    while (block && block !== document.body && getComputedStyle(block).display.indexOf("inline") === 0) block = block.parentElement;
    if (block) {
      var before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(range.startContainer, range.startOffset);
      var start = before.toString().length;
      sentence = around(block.textContent, start, start + String(selection).length);
    }
  } catch (error) { sentence = ""; }
  var url = app + "?add=" + encodeURIComponent(picked.slice(0, 200)) +
    "&sentence=" + encodeURIComponent(sentence.slice(0, 300)) + "&source=" + encodeURIComponent(location.href.slice(0, 2000));
  if (!window.open(url, "_blank")) location.href = url;
}

/* El código del marcador para la app que está en appUrl (la dirección sin ?…).
   Va codificado: así los saltos de línea sobreviven al guardarlo como dirección. */
function bookmarkletCode(appUrl, message) {
  const code = `(${bookmarkletMain.toString()})(${JSON.stringify(appUrl)},${sentenceAround.toString()},${JSON.stringify(message)});`;
  return `javascript:${encodeURIComponent(code)}`;
}

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { CAPTURE_LIMITS, cleanCaptured, safeSourceUrl, looksLikeWord, readCapture, sentenceAround, findWordUnit, bookmarkletMain, bookmarkletCode };
}
