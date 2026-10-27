/* Frases de Tatoeba (CC BY 2.0 FR) para bank/sentences/<nivel>.json. Reglas puras
   de tools/import-tatoeba.mjs: el filtro rápido antes de analizar, qué frases se
   eligen para cada palabra, el prompt con el que la IA las revisa (función
   review-sentences) y la lectura de su respuesta.
   La IA nunca cambia el japonés: decide si la frase vale y corrige o escribe sus
   traducciones. Solo las que aprueba llegan a la app. */

/* Lo que se descarta sin analizar: muy corta o muy larga, con letras latinas,
   paréntesis o comillas sin cerrar, o sin nada japonés */
function quickFilter(text) {
  const chars = [...String(text)];
  if (chars.length < 5 || chars.length > 40) return false;
  if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(text) || /[()（）\[\]［］{}｛｝<>＜＞【】]/.test(text)) return false;
  if ((text.match(/[「『]/g) || []).length !== (text.match(/[」』]/g) || []).length) return false;
  return /[\p{Script=Han}\p{Script=Hiragana}]/u.test(text);
}

/* =========================================
   QUÉ FRASES SE ELIGEN
   -----------------------------------------
   Para cada palabra (las más frecuentes primero) hasta perWord frases de su
   mismo nivel (la frase de una palabra de N5 solo lleva palabras de N5). Una
   frase elegida cuenta para TODAS las palabras de su nivel que lleva, así que
   la que tiene 学校 y 先生 sirve a las dos. Primero las ya aprobadas por la IA,
   luego las que alguien de Tatoeba valoró bien, luego las de longitud media.
   Las rechazadas no se vuelven a elegir: si la IA rechaza una, la siguiente
   ronda elige otra.
     candidates  [{ id, level, targets, plus, units }]  (plus: valoraciones +1)
     words       Map id -> { level, rank }  (rank: frecuencia; menor = más frecuente)
     verdicts    Map id -> "approved" | "rejected"  (sin entrada: sin revisar)
   Devuelve un Set con los ids elegidos.
   ========================================= */
function selectSentences({ candidates, words, verdicts = new Map(), perWord = 3 }) {
  const byWord = new Map();
  for (const candidate of candidates) {
    if (verdicts.get(candidate.id) === "rejected") continue;
    for (const target of candidate.targets) {
      if (words.get(target)?.level !== candidate.level) continue;
      if (!byWord.has(target)) byWord.set(target, []);
      byWord.get(target).push(candidate);
    }
  }
  const score = (candidate) => [
    verdicts.get(candidate.id) === "approved" ? 0 : 1,
    -Math.min(candidate.plus || 0, 3),
    Math.abs((candidate.units || 8) - 8)
  ];
  const compare = (a, b) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, ""));
  };
  const chosen = new Set(), count = new Map();
  const order = [...byWord.keys()].sort((a, b) => (words.get(a).rank ?? 1e9) - (words.get(b).rank ?? 1e9) || (a < b ? -1 : 1));
  for (const word of order) {
    for (const candidate of byWord.get(word).sort(compare)) {
      if ((count.get(word) || 0) >= perWord) break;
      if (chosen.has(candidate.id)) continue;
      chosen.add(candidate.id);
      for (const target of candidate.targets) {
        if (words.get(target)?.level === candidate.level) count.set(target, (count.get(target) || 0) + 1);
      }
    }
  }
  return chosen;
}

/* =========================================
   LA REVISIÓN DE LA IA
   -----------------------------------------
   Copia en supabase/functions/review-sentences/index.ts: no la cambies allí,
   cambia esta y ejecuta node tools/sync-prompt.mjs.
   ========================================= */

const REVIEW_PROMPT_VERSION = "2026-10-27.1";

function renderReviewPrompt({ batch, items }) {
  const list = items.map((item, i) => `${i + 1}. id: ${item.id}
   ja: ${item.ja}
   en: ${item.en || "—"}
   es: ${item.es || "—"}`).join("\n");
  return `You are reviewing Japanese example sentences from the Tatoeba corpus for a Japanese learning app. Learners will study them as models of good Japanese, and Tatoeba contains mistakes, so only keep a sentence you would happily show to a student.

For EACH sentence decide "keep":
- keep is true only if ALL of these hold:
  1. The Japanese is correct and sounds natural to a native speaker today: no typos, no wrong kanji, no grammar mistakes, not a stiff word-by-word translation, not oddly old-fashioned.
  2. The content is suitable for learners of any age: nothing sexual, vulgar, insulting, hateful, violent or cruel; no drugs, self-harm or suicide; no controversial politics or religion; no real people by name.
  3. It makes sense on its own, without the sentence before it.
- If keep is false, give "reason": one of "unnatural", "error", "unsuitable", "context".
- If keep is true, give:
  - "en": a natural English translation that matches the Japanese exactly (tense, politeness, negation, who does what). Start from the English given and change it only if it is wrong, incomplete or unnatural.
  - "es": a natural Spanish translation (neutral Spanish), with the same rules. Start from the Spanish given, if there is one.
Never change, correct or rewrite the Japanese: if it needs any change, keep is false.

SENTENCES
${list}

OUTPUT
Return ONLY this JSON (no explanations, no markdown), one review per sentence, in the same order, with the ids exactly as given:
{"batch":"${batch}","reviews":[
{"id":"${items[0].id}","keep":true,"en":"…","es":"…"},
{"id":"…","keep":false,"reason":"unnatural"}
]}`;
}

/* La respuesta de la IA -> Map id -> { keep, reason } o { keep, en, es }.
   Solo entran los ids pedidos con una decisión completa: una frase aprobada sin
   sus dos traducciones queda sin decidir y se vuelve a pedir. */
const REVIEW_REASONS = ["unnatural", "error", "unsuitable", "context"];
function parseReview(raw, ids) {
  const text = String(raw ?? "");
  const start = text.search(/[{[]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  let data;
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return new Map();
  }
  const list = Array.isArray(data) ? data : data?.reviews;
  const wanted = new Set(ids), result = new Map();
  const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !wanted.has(item.id) || result.has(item.id) || typeof item.keep !== "boolean") continue;
    if (!item.keep) {
      result.set(item.id, { keep: false, reason: REVIEW_REASONS.includes(item.reason) ? item.reason : "other" });
      continue;
    }
    const en = clean(item.en), es = clean(item.es);
    if (en && es) result.set(item.id, { keep: true, en, es });
  }
  return result;
}

/* Quién escribió la frase y su licencia: va con la frase y se enseña en la app */
const attributionOf = (number, username) =>
  `Tatoeba #${number}${username && username !== "\\N" ? ` · ${username}` : ""} · CC BY 2.0 FR`;

module.exports = { quickFilter, selectSentences, REVIEW_PROMPT_VERSION, renderReviewPrompt, parseReview, attributionOf };
