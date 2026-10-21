// =========================================
// KANJI LEARNING APP - Edge Function "generate-sentences"
// Escribe con Gemini frases de ejemplo para palabras que no tienen ninguna.
// La app la llama en segundo plano al repasar «En una frase» (sentences.js),
// comprueba cada frase con la misma regla que las frases comunes y guarda las
// buenas en la tabla shared_sentences, para todos. Aquí solo se habla con la IA:
// no se analiza el japonés (kuromoji y el banco están en la app).
//
// Petición: { level: "N5", words: [{ id: "水|みず", w: "水", r: "みず", meaning: "water" }], known: ["水", …] }
//   words  de 1 a MAX_WORDS palabras; known, las palabras que conoce el usuario
//   (con muchas, la IA solo usa esas; con pocas, el vocabulario del nivel).
// Respuesta: { text, model, promptVersion, remaining }
//
// Secretos (Supabase -> Edge Functions -> Secrets), los mismos que generate-text:
//   GEMINI_API_KEYS / GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL
// y, opcionales:
//   SENTENCE_DAILY_WORDS   palabras con frases nuevas por usuario y día (por defecto 40)
//   SENTENCE_DAILY_CALLS   llamadas a la IA por usuario y día, cuenten o no (por defecto 20)
//
// Cada llamada queda en la tabla sentence_generations (aparte de generations,
// para no gastar la cuota de textos del usuario).
// =========================================

// Lo que depende de Deno va protegido para que las pruebas puedan importar este archivo desde Node.
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
const env = (name: string): string | undefined => typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
let createClient: any = null;

const MODEL = env("GEMINI_MODEL") || "gemini-3.8-flash";
const FALLBACK_MODEL = env("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
const MAX_WORDS = 10;            // palabras por llamada
const MAX_OUTPUT_TOKENS = 8000;
const PER_TARGET = 2;            // frases por palabra
const MIN_KNOWN = 200;           // con menos palabras conocidas se usa el vocabulario del nivel

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const JAPANESE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]{1,20}(\([\p{Script=Hiragana}\p{Script=Katakana}ー]{1,20}\))?$/u;
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]{1,30}$/u;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* Límites de hoy: cuántas palabras le quedan al usuario y si puede llamar.
     rows  las llamadas de hoy: [{ ok, words }] */
export function dailyAllowance(rows: { ok: boolean; words: number }[], read: (name: string) => string | undefined = env) {
  const words = Number(read("SENTENCE_DAILY_WORDS")) || 40;
  const calls = Number(read("SENTENCE_DAILY_CALLS")) || 20;
  const used = rows.filter((row) => row.ok).reduce((sum, row) => sum + (row.words || 0), 0);
  return { remaining: Math.max(0, words - used), blocked: rows.length >= calls, limit: words };
}

// Solo se aceptan datos con forma conocida: la función no es un chat libre
export function readSentenceParams(body: any) {
  if (!body || !LEVELS.includes(body.level) || !Array.isArray(body.words)) return null;
  const words = [];
  const seen = new Set();
  for (const word of body.words.slice(0, MAX_WORDS)) {
    if (!word || typeof word.w !== "string" || typeof word.r !== "string") continue;
    const w = word.w.trim(), r = word.r.trim();
    if (!JAPANESE.test(w) || !KANA.test(r) || seen.has(`${w}|${r}`)) continue;
    seen.add(`${w}|${r}`);
    const meaning = typeof word.meaning === "string" ? word.meaning.replace(/[\r\n`{}<>"]/g, " ").trim().slice(0, 80) : "";
    words.push({ id: `${w}|${r}`, w, r, meaning });
  }
  if (!words.length) return null;
  const known = Array.isArray(body.known)
    ? [...new Set(body.known.filter((w: unknown) => typeof w === "string" && JAPANESE.test(w)))].slice(0, 1500) as string[]
    : [];
  const levels = LEVELS.slice(0, LEVELS.indexOf(body.level) + 1);
  return {
    level: body.level, words,
    vocabulary: known.length >= MIN_KNOWN ? { levels: [body.level], words: known } : { levels, words: null },
  };
}

// Copia de SENTENCE_PROMPT_VERSION y renderSentencePrompt de tools/lib/sentence-batches.js:
// no la cambies aquí, cambia aquella y ejecuta node tools/sync-prompt.mjs.
const SENTENCE_PROMPT_VERSION = "2026-10-21.1";

function renderSentencePrompt({ batch, level, words, vocabulary, perTarget = 2, units = [5, 12] }: any) {
  const vocabularyLine = vocabulary.words
    ? `- Vocabulary: use ONLY these words (plus particles, auxiliaries, common kana words such as これ, する, いる, ある, とても, numbers and counters). Any other word written with kanji makes the sentence useless:\n${vocabulary.words.join("、")}`
    : `- Vocabulary: only words from JLPT ${vocabulary.levels.join(", ")}. Any other word makes the sentence useless.`;
  const list = words.map((word, i) => `${i + 1}. ${word.id}  — ${word.w} read ${word.r} — "${word.meaning}"`).join("\n");
  return `You are writing example sentences for a Japanese learning app. Learners will see a sentence with ONE word highlighted and type how that word is read, so every sentence must be natural, correct Japanese where the word clearly appears with exactly the reading given.

LEVEL: JLPT ${level}
${vocabularyLine}
- Grammar: no harder than JLPT ${level}.

WORDS (id — writing read reading — meaning)
${list}

TASK
- Write ${perTarget} different sentences for EACH word above.
- Each sentence has between ${units[0]} and ${units[1]} units that are not punctuation.
- Use the word with EXACTLY the reading given (a conjugated form is fine: 行く read いく can appear as 行きました, never as 行った read おこなった). Never use a word with another reading or another meaning: 角 read かど means "corner", so never write 角 meaning "horn".
- Make each sentence meaningful and concrete (a small situation), not a definition and not "This is a ___". The two sentences of a word must be different situations.
- A sentence may also contain one or two OTHER words from the list, used with their given reading; list every word of the list it contains in "targets".
- Write with the kanji a normal text of this level would use; words that are normally written in kana stay in kana (ある, いる, する, できる, ください, たくさん).
- No romaji or other Latin letters, no brackets, no furigana, no names of real people. Japanese quotes 「」 only if they open and close in the same sentence.

SEGMENTATION ("ja" field)
1. "ja" is the sentence with "|" between units. Removing every "|" must give the exact sentence: no spaces, nothing added, nothing dropped.
2. A conjugated verb or adjective is ONE unit together with its endings and auxiliaries (食べています, 高くなかった, 行きましょう).
3. Particles are separate units (は, が, を, に, で, も, と, の, か, ね, よ). です and だ after a noun or adjective are their own unit.
4. Compound words stay together as in a dictionary (毎日, 図書館, 一緒に).
5. Every punctuation mark is its own unit. No empty units: never "||", and no "|" at the start or the end.

OUTPUT
Return ONLY this JSON (no explanations, no markdown), with ${perTarget * words.length} sentences:
{"batch":"${batch}","sentences":[
{"targets":["${words[0].id}"],"ja":"…|…|。","en":"natural English translation","es":"traducción natural al español"}
]}
"targets" uses the ids exactly as written in the list (writing|reading).`;
}

/* Claves disponibles, cada una con la etiqueta que se guarda en el registro */
function apiKeys(): { label: string; key: string }[] {
  const list = (env("GEMINI_API_KEYS") || "").split(",").map((entry, index) => {
    const cut = entry.indexOf("=");
    return cut > 0
      ? { label: entry.slice(0, cut).trim(), key: entry.slice(cut + 1).trim() }
      : { label: `clave${index + 1}`, key: entry.trim() };
  }).filter((entry) => entry.key);
  const single = env("GEMINI_API_KEY");
  if (single) list.push({ label: "default", key: single.trim() });
  return list;
}

async function callGemini(model: string, prompt: string, key: string, full = true) {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
  if (full) {
    Object.assign(generationConfig, {
      maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.8, thinkingConfig: { thinkingLevel: "low" },
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

/* La respuesta tiene que ser JSON con una lista de frases; el resto lo comprueba la app */
function readable(text: string) {
  const start = text.search(/[{[]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  try {
    const data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
    const list = Array.isArray(data) ? data : data?.sentences;
    return Array.isArray(list) && list.length ? "" : "missing_fields";
  } catch {
    return "invalid_json";
  }
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "bad_request" });

  const keys = apiKeys();
  if (!keys.length) return reply(500, { error: "not_configured" });

  // Quién llama: el token de sesión de la app
  const url = env("SUPABASE_URL")!;
  const userClient = createClient(url, env("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: auth } = await userClient.auth.getUser();
  const user = auth?.user;
  if (!user) return reply(401, { error: "unauthorized" });

  const params = readSentenceParams(await req.json().catch(() => null));
  if (!params) return reply(400, { error: "bad_request" });

  // Uso de hoy (tabla sentence_generations, solo accesible desde aquí)
  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { data: rows, error: countError } = await admin.from("sentence_generations")
    .select("ok, words").eq("user_id", user.id).gte("created_at", today.toISOString());
  if (countError) return reply(500, { error: "not_configured", detail: countError.message });
  const allowance = dailyAllowance(rows);
  if (allowance.blocked) return reply(429, { error: "busy" });
  if (!allowance.remaining) return reply(429, { error: "limit", limit: allowance.limit });
  const words = params.words.slice(0, allowance.remaining);

  const prompt = renderSentencePrompt({
    batch: "app", level: params.level, words, vocabulary: params.vocabulary, perTarget: PER_TARGET,
  });

  // Cada clave con el modelo principal y, si todas fallan, con el de reserva.
  // Solo se pasa a la siguiente cuando el fallo es de cuota, de clave o del servicio.
  const models = FALLBACK_MODEL && FALLBACK_MODEL !== MODEL ? [MODEL, FALLBACK_MODEL] : [MODEL];
  const attempts: string[] = [];
  let model = MODEL, label = keys[0].label;
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
  const text = (candidate?.content?.parts || []).map((p: any) => p.text || "").join("");
  const usage = result.data?.usageMetadata || {};
  const failure = [401, 403, 429].includes(result.status) ? "quota"
    : result.status !== 200 ? "provider"
    : candidate?.finishReason === "MAX_TOKENS" ? "truncated"
    : !text ? "empty" : readable(text);

  await admin.from("sentence_generations").insert({
    user_id: user.id, words: words.length, ok: !failure, result: failure || "ok",
    level: params.level, model, key_label: label, attempts: attempts.join(" ") || null,
    prompt_version: SENTENCE_PROMPT_VERSION,
    prompt_tokens: usage.promptTokenCount ?? null, output_tokens: usage.candidatesTokenCount ?? null,
    error: failure ? `${failure}: ${result.status} ${JSON.stringify(result.data?.error?.message || "").slice(0, 300)}` : null,
    raw: text ? text.slice(0, 40000) : null,
  });

  if (failure) return reply(failure === "quota" ? 503 : 502, { error: failure });
  return reply(200, {
    text, model, promptVersion: SENTENCE_PROMPT_VERSION,
    words: words.map((word) => word.id), remaining: allowance.remaining - words.length,
  });
}

if (typeof Deno !== "undefined") {
  // @ts-ignore: "npm:" lo resuelve Deno en Supabase; el editor (TypeScript normal) no lo conoce
  ({ createClient } = await import("npm:@supabase/supabase-js@2"));
  Deno.serve(handler);
}
