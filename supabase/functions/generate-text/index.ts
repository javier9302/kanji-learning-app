// =========================================
// KANJI LEARNING APP - Edge Function "generate-text"
// Genera un texto de lectura con Gemini para un usuario con sesión.
// La clave de la IA vive aquí (secreto GEMINI_API_KEY), nunca en la app.
//
// Secretos (Supabase -> Edge Functions -> Secrets):
//   GEMINI_API_KEYS         una o varias claves de Google AI Studio con etiqueta,
//                           separadas por comas:  personal=CLAVE1,reserva=CLAVE2
//                           Se prueban en orden; si una se queda sin cuota, la siguiente.
//   GEMINI_API_KEY          alternativa con una sola clave (etiqueta "default")
//   GEMINI_MODEL            opcional, por defecto gemini-3.8-flash
//   GEMINI_FALLBACK_MODEL   opcional, por defecto gemini-3.5-flash-lite
//   DAILY_TEXTS             opcional, textos ENTREGADOS por usuario y día (por defecto 10)
//   DAILY_HARD_CAP          opcional, tope de llamadas a la IA por usuario y día, cuenten
//                           o no (por defecto el triple de DAILY_TEXTS)
//
// Cuota justa: al estudiante solo le cuenta un texto que recibe y puede leer.
// Los fallos de la IA o del sistema no cuentan. La app repite la petición con
// el mismo "requestId" (como mucho 3 intentos) y aquí se guarda cada fallo con
// la respuesta de la IA para poder revisarlo (tabla generations).
// =========================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
const DAILY_TEXTS = Number(Deno.env.get("DAILY_TEXTS")) || Number(Deno.env.get("DAILY_CALLS")) || 10;
const DAILY_HARD_CAP = Number(Deno.env.get("DAILY_HARD_CAP")) || DAILY_TEXTS * 3;
const MAX_ATTEMPTS = 3; // el primero y dos reintentos
const MAX_OUTPUT_TOKENS = 30000;

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const TYPES = ["short story", "dialogue", "diary entry", "message or email", "description", "simple news article"];
const LENGTHS = [50, 100, 150];
// Una palabra, opcionalmente con su lectura entre paréntesis: 角(かど)
const JAPANESE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]{1,20}(\([\p{Script=Hiragana}\p{Script=Katakana}ー]{1,20}\))?$/u;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Claves disponibles, cada una con la etiqueta que se guarda en el registro */
function apiKeys(): { label: string; key: string }[] {
  const list = (Deno.env.get("GEMINI_API_KEYS") || "").split(",").map((entry, index) => {
    const cut = entry.indexOf("=");
    return cut > 0
      ? { label: entry.slice(0, cut).trim(), key: entry.slice(cut + 1).trim() }
      : { label: `clave${index + 1}`, key: entry.trim() };
  }).filter((entry) => entry.key);
  const single = Deno.env.get("GEMINI_API_KEY");
  if (single) list.push({ label: "default", key: single.trim() });
  return list;
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TOKEN_POS = [
  "noun", "proper_noun", "pronoun", "verb", "i_adjective", "na_adjective", "adverb",
  "particle", "auxiliary", "conjunction", "interjection", "determiner", "counter",
  "number", "prefix", "suffix", "expression", "punctuation", "symbol"
];

// Copia de PROMPT_VERSION y renderPrompt de reading.js: si cambias una, cambia la otra.
// deno-lint-ignore-file no-explicit-any
/* Versión del prompt: súbela cada vez que cambies su texto. Se guarda con cada
   generación para saber con qué versión salió cada error. */
const PROMPT_VERSION = "2026-10-08.1";

/* El prompt en sí. IMPORTANTE: supabase/functions/generate-text/index.ts lleva
   una copia de esta función (allí se genera el texto con la IA); si cambias
   una, cambia la otra. No usa nada de fuera salvo TOKEN_POS. */
function renderPrompt({ level, type, topic, length, known, assumedLevels, learning }: any) {
  const fresh = Math.round(length * 0.1);
  // Las IA cuentan mal "palabras": se da un mínimo de tokens y su equivalente en oraciones
  const minTokens = Math.round(length * 0.9), maxTokens = Math.round(length * 1.25);
  const minSentences = Math.ceil(length / 9), maxSentences = Math.ceil(length / 6.5);
  const knownLine = assumedLevels.length
    ? `Known words: all standard JLPT ${assumedLevels.join(", ")} vocabulary` +
      (known.length ? `, plus: ${known.join("、")}` : ".")
    : known.length
      ? `Known words (the learner can read these): ${known.join("、")}`
      : "Known words: none yet. Use only the most basic beginner vocabulary.";

  return `You are writing a graded Japanese reading text for a learner.

LEARNER
- Target level: JLPT ${level}.
- ${knownLine}
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}- A word written with its reading in brackets, like 角(かど), has several readings: use it ONLY with that reading and its meaning (角(かど) is "corner", never つの "horn").

TEXT
- Type: ${type}. Topic: ${topic}.
- LENGTH (strict): across all sentences, the "tokens" arrays must contain between ${minTokens} and ${maxTokens} tokens that are not punctuation. That is about ${minSentences}-${maxSentences} sentences. Count the tokens before answering: a text with fewer than ${minTokens} is rejected. If you are short, continue the story with more sentences; do not pad with filler.
- Natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- Split it into short paragraphs (in a dialogue, one paragraph per speaker turn).
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use. Words that Japanese normally writes in kana must stay in kana (ある, いる, する, できる, ください, たくさん, かわいい, おいしい): never use rare kanji spellings such as 有る, 居る, 為る, 出来る, 下さい or 沢山.

OUTPUT
Return ONLY one JSON object (no explanations, no markdown), as compact JSON without indentation or line breaks, with exactly this structure (shown indented here only for readability):

{
  "title": "毎朝のコーヒー",
  "title_en": "Morning coffee",
  "title_es": "El café de cada mañana",
  "topic": "${topic}",
  "level": "${level}",
  "sentences": [
    {
      "id": 1,
      "paragraph": 1,
      "jp": "私は毎朝コーヒーを飲みます。",
      "en": "I drink coffee every morning.",
      "es": "Bebo café todas las mañanas.",
      "tokens": [
        { "surface": "私", "lemma": "私", "reading": "わたし", "pos": "pronoun" },
        { "surface": "は", "lemma": "は", "reading": "は", "pos": "particle" },
        { "surface": "毎朝", "lemma": "毎朝", "reading": "まいあさ", "pos": "noun" },
        { "surface": "コーヒー", "lemma": "コーヒー", "reading": "コーヒー", "pos": "noun" },
        { "surface": "を", "lemma": "を", "reading": "を", "pos": "particle" },
        { "surface": "飲みます", "lemma": "飲む", "reading": "のみます", "pos": "verb" },
        { "surface": "。", "lemma": "。", "reading": "。", "pos": "punctuation" }
      ],
      "dictionary": {
        "私": { "reading": "わたし", "meanings": ["I", "me"], "meanings_es": ["yo"], "pos": "pronoun" },
        "毎朝": { "reading": "まいあさ", "meanings": ["every morning"], "meanings_es": ["todas las mañanas"], "pos": "noun" },
        "コーヒー": { "reading": "コーヒー", "meanings": ["coffee"], "meanings_es": ["café"], "pos": "noun" },
        "飲む": { "reading": "のむ", "meanings": ["to drink"], "meanings_es": ["beber"], "pos": "godan verb" }
      }
    }
  ]
}

RULES
1. "tokens" splits the sentence into words. Joining every "surface" in order must reproduce "jp" exactly, punctuation included.
2. Keep a conjugated verb or adjective together with its endings as ONE token (飲みます, 食べました, 高くない).
3. "surface" is the word as written; "lemma" is its dictionary form (飲みます → 飲む); the token "reading" is the reading of the surface as written, in hiragana (katakana words stay in katakana).
4. Token "pos" must be one of: ${TOKEN_POS.join(", ")}.
5. "dictionary" has one entry, keyed by lemma, for every token of the sentence except particle, auxiliary, punctuation, symbol, number and proper_noun. Each entry has "reading" (of the lemma, in kana), "meanings" (1-3, English), "meanings_es" (1-3, Spanish) and "pos" (free text).
6. "en" and "es" are natural translations of the sentence. "title_en" and "title_es" translate the title.
7. Sentence ids start at 1 and increase by 1. "paragraph" is the number of the paragraph the sentence belongs to, starting at 1.`;
}

// Copia de SEGMENTED_VERSION y renderPromptSeg de reading.js: si cambias una, cambia la otra.
/* Versión del prompt segmentado (formato nuevo): súbela al cambiar su texto. */
const SEGMENTED_VERSION = "2026-10-09.2-seg";

/* Prompt del formato nuevo: la IA solo escribe el texto separado en unidades
   con "|" y la traducción de cada oración. Lemas, lecturas y significados los
   pone la app (kuromoji + diccionario). IMPORTANTE: la función generate-text
   lleva una copia de esta función; si cambias una, cambia la otra. */
function renderPromptSeg({ level, type, topic, length, known, assumedLevels, learning, prefer = [] }: any) {
  const fresh = Math.round(length * 0.1);
  const minUnits = Math.round(length * 0.9), maxUnits = Math.round(length * 1.25);
  const minSentences = Math.ceil(length / 9), maxSentences = Math.ceil(length / 6.5);
  const knownLine = assumedLevels.length
    ? `Known words: all standard JLPT ${assumedLevels.join(", ")} vocabulary` +
      (known.length ? `, plus: ${known.join("、")}` : ".")
    : known.length
      ? `Known words (the learner can read these): ${known.join("、")}`
      : "Known words: none yet. Use only the most basic beginner vocabulary.";

  return `You are writing a graded Japanese reading text for a learner.

LEARNER
- Target level: JLPT ${level}.
- ${knownLine}
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}${prefer.length ? `- Common words written in kana, most frequent first. Prefer them when they fit naturally; they do not count as new words: ${prefer.join("、")}\n` : ""}- A word written with its reading in brackets, like 角(かど), has several readings: use it ONLY with that reading and its meaning (角(かど) is "corner", never つの "horn"). Never write the brackets in the text.

TEXT
- Type: ${type}. Topic: ${topic}.
- LENGTH (strict): the text must contain between ${minUnits} and ${maxUnits} units that are not punctuation, in about ${minSentences}-${maxSentences} sentences. Count them before answering: a text with fewer than ${minUnits} is rejected. If you are short, continue the story with more sentences.
- Natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use. Words that Japanese normally writes in kana must stay in kana (ある, いる, する, できる, ください, たくさん, かわいい, おいしい): never use rare kanji spellings such as 有る, 居る, 為る, 出来る, 下さい or 沢山.

OUTPUT
Return ONLY one compact JSON object (no explanations, no markdown), with exactly these fields:

{"title":"毎朝のコーヒー","title_en":"Morning coffee","title_es":"El café de cada mañana","sentences":[
{"p":1,"ja":"私|は|毎朝|コーヒー|を|飲みます|。","en":"I drink coffee every morning.","es":"Bebo café todas las mañanas."},
{"p":1,"ja":"今日|は|新しい|店|で|買いました|が|、|あまり|おいしくなかった|です|。","en":"Today I bought it at a new shop, but it was not very good.","es":"Hoy lo compré en una tienda nueva, pero no estaba muy bueno."},
{"p":2,"ja":"「|明日|も|一緒に|行きません|か|」|と|友達|に|聞かれました|。","en":"\\"Won't you come with me tomorrow too?\\" my friend asked me.","es":"«¿No vienes conmigo mañana también?», me preguntó mi amigo."}]}

SEGMENTATION RULES
1. "ja" is the sentence with "|" between units. Removing every "|" must give the exact sentence: no spaces, nothing added, nothing dropped.
2. A conjugated verb or adjective is ONE unit together with its endings and auxiliaries (食べています, 高くなかった, 行きましょう, 聞かれました).
3. Particles are separate units (は, が, を, に, で, も, と, の, か, ね, よ). です and だ after a noun or adjective are their own unit.
4. Compound words stay as they appear in a dictionary (毎日, 食事中, 図書館, 一緒に).
5. Every punctuation mark and bracket is its own unit.
6. No empty units: never "||", and no "|" at the start or the end.
7. Do NOT give lemmas, readings, word translations or parts of speech. Only "p", "ja", "en" and "es".
8. "p" is the paragraph number, starting at 1 (in a dialogue, one paragraph per speaker turn). "en" and "es" are natural translations of the whole sentence.`;
}

/* Formato nuevo (texto segmentado con "|"): JSON válido, cada oración con "ja",
   "en" y "es", y ninguna unidad vacía. Al quitar los "|" queda el texto tal
   cual, así que no puede perder ni ganar caracteres. */
function checkSegmented(text: string, length: number, lastAttempt: boolean): Check {
  const start = text.search(/[{[]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  let data: any;
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch (error) {
    return { code: "invalid_json", problems: [`The answer is not valid JSON: ${(error as Error).message}`] };
  }
  const list = Array.isArray(data) ? data : data?.sentences;
  if (!Array.isArray(list) || !list.length) return { code: "missing_fields", problems: ['"sentences" must be a non-empty list.'] };
  const missing: string[] = [], empty: string[] = [];
  let count = 0;
  list.forEach((sentence: any, index: number) => {
    const n = index + 1;
    for (const field of ["ja", "en", "es"]) {
      if (!sentence || typeof sentence[field] !== "string" || !sentence[field].trim()) missing.push(`Sentence ${n}: "${field}" is missing.`);
    }
    if (typeof sentence?.ja !== "string") return;
    const units = sentence.ja.split("|");
    if (units.some((unit: string) => !unit.trim())) empty.push(`Sentence ${n}: empty unit ("||", or "|" at the start or the end) in "${sentence.ja.slice(0, 60)}".`);
    count += units.filter((unit: string) => unit.trim() && !/^[\s\p{P}\p{S}]+$/u.test(unit)).length;
  });
  if (missing.length) return { code: "missing_fields", problems: missing };
  if (empty.length) return { code: "empty_units", problems: empty };
  if (!lastAttempt && count < length * 0.7) {
    return { code: "too_short", problems: [`The text is too short: it has ${count} units that are not punctuation and needs at least ${Math.round(length * 0.9)}. Keep the story and add sentences that continue it.`] };
  }
  return { code: "", problems: [] };
}

const words = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value.filter((w) => typeof w === "string" && JAPANESE.test(w)).slice(0, max)
    : [];

// Solo se aceptan datos con forma conocida: la función no es un chat libre
// deno-lint-ignore no-explicit-any
function readParams(body: any) {
  if (!body || !LEVELS.includes(body.level) || !TYPES.includes(body.type) ||
      !LENGTHS.includes(body.length) || typeof body.topic !== "string") return null;
  const topic = body.topic.replace(/[\r\n`{}<>]/g, " ").trim().slice(0, 80);
  if (!topic) return null;
  return {
    level: body.level, type: body.type, topic, length: body.length,
    format: body.format === 2 ? 2 : 1, // 2 = texto segmentado con "|" (las versiones antiguas de la app piden el 1)
    known: words(body.known, 1500),
    assumedLevels: Array.isArray(body.assumedLevels) ? LEVELS.filter((l) => body.assumedLevels.includes(l)) : [],
    learning: words(body.learning, 60),
    prefer: words(body.prefer, 80),
  };
}

function fixPrompt(prompt: string, previous: string, problems: string) {
  return `${prompt}

YOUR PREVIOUS ANSWER WAS REJECTED by the validator:
${problems.slice(0, 2000)}

Previous answer:
${previous.slice(0, 60000)}

Return the complete corrected JSON object, following every rule above.`;
}

/* Lo único que hace ilegible un texto: que no sea JSON o que los tokens no
   reconstruyan la oración. (La app lleva la misma comprobación en reading.js,
   función structureErrors.) Si aún quedan intentos, también se devuelve a la
   IA un texto mucho más corto de lo pedido. */
type Check = { code: string; problems: string[] };

/* code: "" si es legible, o el tipo de fallo que se guarda en el registro:
   invalid_json | missing_fields | tokens_mismatch | too_short */
function checkStructure(text: string, length: number, lastAttempt: boolean): Check {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  // deno-lint-ignore no-explicit-any
  let data: any;
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch (error) {
    return { code: "invalid_json", problems: [`The answer is not valid JSON: ${(error as Error).message}`] };
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.sentences) || !data.sentences.length) {
    return { code: "missing_fields", problems: ['"sentences" must be a non-empty list.'] };
  }
  const problems: string[] = [];
  let count = 0, mismatch = false;
  // deno-lint-ignore no-explicit-any
  data.sentences.forEach((sentence: any, index: number) => {
    const n = index + 1;
    if (!sentence || typeof sentence.jp !== "string" || !sentence.jp.trim()) return problems.push(`Sentence ${n}: "jp" is missing.`);
    if (!Array.isArray(sentence.tokens) || !sentence.tokens.length) return problems.push(`Sentence ${n}: "tokens" must be a non-empty list.`);
    // deno-lint-ignore no-explicit-any
    if (sentence.tokens.some((token: any) => !token || typeof token.surface !== "string" || !token.surface)) {
      return problems.push(`Sentence ${n}: every token needs a non-empty "surface".`);
    }
    // deno-lint-ignore no-explicit-any
    const joined = sentence.tokens.map((token: any) => token.surface).join("");
    if (joined !== sentence.jp) {
      mismatch = true;
      problems.push(`Sentence ${n}: the token surfaces joined ("${joined.slice(0, 60)}") do not reproduce "jp" ("${sentence.jp.slice(0, 60)}").`);
    }
    // deno-lint-ignore no-explicit-any
    count += sentence.tokens.filter((token: any) => token.pos !== "punctuation" && token.pos !== "symbol").length;
  });
  if (problems.length) return { code: mismatch ? "tokens_mismatch" : "missing_fields", problems };
  if (!lastAttempt && count < length * 0.7) {
    return { code: "too_short", problems: [`The text is too short: it has ${count} non-punctuation tokens and needs at least ${Math.round(length * 0.9)}. Keep the story and add sentences that continue it.`] };
  }
  return { code: "", problems: [] };
}

async function callGemini(model: string, prompt: string, key: string, full = true) {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
  if (full) {
    Object.assign(generationConfig, {
      maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.9, thinkingConfig: { thinkingLevel: "low" },
    });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
    },
  );
  const data = await response.json().catch(() => ({}));
  // Un modelo puede no admitir alguna opción: se reintenta con lo mínimo
  if (response.status === 400 && full) return callGemini(model, prompt, key, false);
  return { status: response.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "bad_request" });

  const keys = apiKeys();
  if (!keys.length) return reply(500, { error: "not_configured" });

  // Quién llama: el token de sesión de la app
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: auth } = await userClient.auth.getUser();
  const user = auth?.user;
  if (!user) return reply(401, { error: "unauthorized" });

  const body = await req.json().catch(() => null);
  const params = readParams(body);
  if (!params) return reply(400, { error: "bad_request" });
  const requestId = typeof body.requestId === "string" && /^[\w-]{8,64}$/.test(body.requestId)
    ? body.requestId : crypto.randomUUID();

  // Uso de hoy (tabla generations, solo accesible desde aquí)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { data: rows, error: countError } = await admin.from("generations")
    .select("id, request_id, ok").eq("user_id", user.id).gte("created_at", today.toISOString());
  if (countError) return reply(500, { error: "not_configured", detail: countError.message });

  const mine = rows.filter((row) => row.request_id === requestId);
  const attempt = mine.length + 1;
  // Textos entregados hoy: es lo único que cuenta para el límite del estudiante
  const delivered = new Set(rows.filter((row) => row.ok).map((row) => row.request_id || row.id)).size;
  if (mine.some((row) => row.ok)) return reply(400, { error: "bad_request" });
  if (attempt > MAX_ATTEMPTS) return reply(429, { error: "invalid", canRetry: false });
  if (attempt === 1 && delivered >= DAILY_TEXTS) return reply(429, { error: "limit", limit: DAILY_TEXTS });
  if (rows.length >= DAILY_HARD_CAP) return reply(429, { error: "busy" });

  // En un reintento se le devuelve a la IA su respuesta anterior con el motivo del rechazo
  const segmented = params.format === 2;
  const version = segmented ? SEGMENTED_VERSION : PROMPT_VERSION;
  let prompt = segmented ? renderPromptSeg(params) : renderPrompt(params);
  if (attempt > 1) {
    const { data: previous } = await admin.from("generations").select("raw, error")
      .eq("user_id", user.id).eq("request_id", requestId).not("raw", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    if (previous?.[0]) prompt = fixPrompt(prompt, previous[0].raw, previous[0].error || "");
  }

  // Se prueba cada clave con el modelo principal y, si todas fallan, con el de
  // reserva. Solo se pasa a la siguiente cuando el fallo es de cuota, de clave o
  // del servicio; un texto devuelto (aunque sea malo) detiene la búsqueda.
  const models = FALLBACK_MODEL && FALLBACK_MODEL !== MODEL ? [MODEL, FALLBACK_MODEL] : [MODEL];
  const attempts: string[] = [];
  let model = MODEL, label = keys[0].label;
  // deno-lint-ignore no-explicit-any
  let result: { status: number; data: any } = { status: 0, data: {} };
  search:
  for (model of models) {
    for (const entry of keys) {
      label = entry.label;
      result = await callGemini(model, prompt, entry.key);
      if (![401, 403, 429, 500, 503].includes(result.status)) break search;
      attempts.push(`${label}/${model}:${result.status}`);
    }
  }

  const candidate = result.data?.candidates?.[0];
  // deno-lint-ignore no-explicit-any
  const text = (candidate?.content?.parts || []).map((p: any) => p.text || "").join("");
  const usage = result.data?.usageMetadata || {};
  let failure = [401, 403, 429].includes(result.status) ? "quota"
    : result.status !== 200 ? "provider"
    : candidate?.finishReason === "MAX_TOKENS" ? "truncated"
    : !text ? "empty" : "";
  let detail = failure ? `${result.status} ${JSON.stringify(result.data?.error?.message || "").slice(0, 300)}` : "";
  // Tipo de resultado que queda en el registro: ok, o qué falló exactamente
  let outcome = failure || "ok";
  if (!failure) {
    const check = (segmented ? checkSegmented : checkStructure)(text, params.length, attempt >= MAX_ATTEMPTS);
    if (check.code) { failure = "invalid"; outcome = check.code; detail = check.problems.slice(0, 12).join("\n"); }
  }

  await admin.from("generations").insert({
    user_id: user.id, request_id: requestId, attempt,
    prompt_version: version, result: outcome,
    // Con qué se pidió el texto (de las listas de palabras solo se guarda cuántas eran)
    params: {
      level: params.level, type: params.type, topic: params.topic, length: params.length, format: params.format,
      known: params.known.length, learning: params.learning.length, assumedLevels: params.assumedLevels,
    },
    model, key_label: label, attempts: attempts.join(" ") || null,
    level: params.level, length: params.length, is_fix: attempt > 1,
    prompt_tokens: usage.promptTokenCount ?? null,
    output_tokens: usage.candidatesTokenCount ?? null,
    thought_tokens: usage.thoughtsTokenCount ?? null,
    ok: !failure,
    error: failure ? `${failure}: ${detail}` : null,
    raw: text ? text.slice(0, 80000) : null, // lo que respondió la IA, haya ido bien o mal
  });

  if (failure) {
    // Sin cuota en ninguna clave no sirve reintentar; el resto de fallos sí
    const canRetry = failure !== "quota" && attempt < MAX_ATTEMPTS;
    return reply(failure === "quota" ? 503 : 502, { error: failure, canRetry });
  }
  return reply(200, { text, model, requestId, promptVersion: version, remaining: DAILY_TEXTS - delivered - 1 });
});
