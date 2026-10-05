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
//   DAILY_CALLS             opcional, llamadas por usuario y día (por defecto 10)
// =========================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
const DAILY_CALLS = Number(Deno.env.get("DAILY_CALLS")) || 10;
const MAX_OUTPUT_TOKENS = 30000;

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const TYPES = ["short story", "dialogue", "diary entry", "message or email", "description", "simple news article"];
const LENGTHS = [50, 100, 150];
const JAPANESE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]{1,20}$/u;

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

// Copia de renderPrompt de reading.js: si cambias una, cambia la otra.
// deno-lint-ignore no-explicit-any
function renderPrompt({ level, type, topic, length, known, assumedLevels, learning }: any) {
  const fresh = Math.round(length * 0.1);
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
${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}
TEXT
- Type: ${type}. Topic: ${topic}.
- Length: about ${length} words (count the tokens that are not punctuation), in natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
- Split it into short paragraphs (in a dialogue, one paragraph per speaker turn).
- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use.

OUTPUT
Return ONLY one JSON object (no explanations, no markdown), with exactly this structure:

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
    known: words(body.known, 1500),
    assumedLevels: Array.isArray(body.assumedLevels) ? LEVELS.filter((l) => body.assumedLevels.includes(l)) : [],
    learning: words(body.learning, 60),
  };
}

// deno-lint-ignore no-explicit-any
function fixPrompt(prompt: string, fix: any) {
  const errors = (Array.isArray(fix.errors) ? fix.errors : [])
    .filter((e: unknown) => typeof e === "string").slice(0, 12).map((e: string) => `- ${e.slice(0, 300)}`);
  return `${prompt}

YOUR PREVIOUS ANSWER WAS REJECTED by the validator with these errors:
${errors.join("\n")}

Previous answer:
${String(fix.previous).slice(0, 60000)}

Return the complete corrected JSON object, following every rule above.`;
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
  const isFix = !!(body.fix && typeof body.fix.previous === "string");

  // Límite diario por usuario (tabla generations, solo accesible desde aquí)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await admin.from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", today.toISOString());
  if (countError) return reply(500, { error: "not_configured", detail: countError.message });
  if ((count ?? 0) >= DAILY_CALLS) return reply(429, { error: "limit", limit: DAILY_CALLS });

  const prompt = isFix ? fixPrompt(renderPrompt(params), body.fix) : renderPrompt(params);

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
  const failure = [401, 403, 429].includes(result.status) ? "quota"
    : result.status !== 200 ? "provider"
    : candidate?.finishReason === "MAX_TOKENS" ? "truncated"
    : !text ? "empty" : "";

  await admin.from("generations").insert({
    user_id: user.id, model, key_label: label, attempts: attempts.join(" ") || null,
    level: params.level, length: params.length, is_fix: isFix,
    prompt_tokens: usage.promptTokenCount ?? null,
    output_tokens: usage.candidatesTokenCount ?? null,
    thought_tokens: usage.thoughtsTokenCount ?? null,
    ok: !failure,
    error: failure ? `${failure} ${result.status} ${JSON.stringify(result.data?.error?.message || "").slice(0, 300)}` : null,
  });

  if (failure) return reply(failure === "quota" ? 503 : 502, { error: failure });
  return reply(200, { text, model, remaining: DAILY_CALLS - (count ?? 0) - 1 });
});
