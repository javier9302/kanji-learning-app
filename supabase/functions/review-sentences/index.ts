// =========================================
// KANJI LEARNING APP - Edge Function "review-sentences"
// Revisa con Gemini frases de Tatoeba antes de que entren en las frases comunes
// de la app (bank/sentences): decide si el japonés es correcto, natural y
// adecuado, y corrige o escribe sus traducciones. Nunca cambia el japonés.
// Solo la llama la herramienta tools/import-tatoeba.mjs, desde el ordenador del
// administrador; la app no la usa. Aquí solo se habla con la IA: la herramienta
// lee la respuesta (parseReview, tools/lib/tatoeba.js) y guarda el resultado.
//
// Petición: { batch: "t…", items: [{ id: "tatoeba-123", ja, en, es }] }  (de 1 a MAX_ITEMS)
// Cabecera:  x-review-token: <SENTENCE_REVIEW_TOKEN>
// Respuesta: { text, model, promptVersion }
//
// Secretos (Supabase -> Edge Functions -> Secrets):
//   SENTENCE_REVIEW_TOKEN   el token que debe traer la herramienta (sin él, la función no responde)
//   GEMINI_API_KEYS / GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL  (los de generate-text)
// Se despliega sin "Verify JWT": la protege el token, y la herramienta no tiene sesión.
// =========================================

// Lo que depende de Deno va protegido para que las pruebas puedan importar este archivo desde Node.
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
const env = (name: string): string | undefined => typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;

const MODEL = env("GEMINI_MODEL") || "gemini-3.8-flash";
const FALLBACK_MODEL = env("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
const MAX_ITEMS = 50;
const MAX_OUTPUT_TOKENS = 16000;
// Gemini a veces se queda colgado (la misma petición tarda 8 s o más de 150) y Supabase
// corta la función a los 150 s: cada intento espera como mucho ATTEMPT_MS y, si no
// contesta, se prueba la clave o el modelo siguiente, sin pasar de BUDGET_MS en total
const ATTEMPT_MS = 45000;
const BUDGET_MS = 140000;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* Compara dos textos en el mismo tiempo pase lo que pase (no revela cuánto coincide) */
export function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Solo se aceptan datos con forma conocida: la función no es un chat libre
export function readReviewParams(body: any) {
  if (!body || typeof body.batch !== "string" || !/^[\w-]{1,40}$/.test(body.batch) || !Array.isArray(body.items)) return null;
  const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\r\n`]/g, " ").trim().slice(0, max) : "";
  const items = [];
  const seen = new Set();
  for (const item of body.items.slice(0, MAX_ITEMS * 2)) {
    if (items.length >= MAX_ITEMS) break;
    if (!item || typeof item.id !== "string" || !/^tatoeba-\d{1,12}$/.test(item.id) || seen.has(item.id)) continue;
    const ja = clean(item.ja, 80);
    if (!ja || !/[\p{Script=Han}\p{Script=Hiragana}]/u.test(ja)) continue;
    seen.add(item.id);
    items.push({ id: item.id, ja, en: clean(item.en, 300), es: clean(item.es, 300) });
  }
  return items.length ? { batch: body.batch, items } : null;
}

// Copia de REVIEW_PROMPT_VERSION y renderReviewPrompt de tools/lib/tatoeba.js:
// no la cambies aquí, cambia aquella y ejecuta node tools/sync-prompt.mjs.
const REVIEW_PROMPT_VERSION = "2026-10-27.2";

function renderReviewPrompt({ batch, items }: any) {
  const list = items.map((item, i) => `${i + 1}. id: ${item.id}
   ja: ${item.ja}
   en: ${item.en || "—"}
   es: ${item.es || "—"}`).join("\n");
  return `You are reviewing Japanese example sentences from the Tatoeba corpus for a Japanese learning app. Learners will study them as models of good Japanese, and Tatoeba contains mistakes, so only keep a sentence you would happily show to a student.

For EACH sentence decide "keep":
- keep is true only if ALL of these hold:
  1. The Japanese is correct and sounds natural to a native speaker today: no typos, no wrong kanji, no grammar mistakes, not a stiff word-by-word translation, not oddly old-fashioned.
  2. The content is suitable for learners of any age: nothing sexual, vulgar, insulting, hateful, violent or cruel; no drugs, self-harm or suicide; no controversial politics or religion; no famous real people (politicians, celebrities) by name.
  3. It makes sense on its own: reject it only if it clearly continues an earlier sentence (starts with "but", "so", "that", or refers to something never mentioned, like "the other one").
- Tatoeba uses everyday first names (Tom, Mary, John, Roger, 直子, 春子…) for ordinary fictional people: a sentence with such a name is fine. So are ordinary everyday sentences about people, family, pets, work or opinions, and casual spoken Japanese (よ, ね, の, わ, contractions like 遊んでる).
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

/* Claves disponibles, cada una con su etiqueta (como en generate-text) */
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

async function callGemini(model: string, prompt: string, key: string, timeout: number, full = true): Promise<{ status: number; data: any }> {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
  if (full) {
    // Revisar pide criterio, no imaginación: temperatura baja. Pensando con "low", 10 frases
    // tardaban de 100 a más de 150 s y Supabase corta a los 150 (error 546): se piensa lo mínimo
    Object.assign(generationConfig, {
      maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.2, thinkingConfig: { thinkingLevel: "minimal" },
    });
  }
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(timeout),
      },
    );
  } catch {
    return { status: 408, data: {} }; // no contestó a tiempo
  }
  const data = await response.json().catch(() => ({}));
  // Un modelo puede no admitir alguna opción: se reintenta con lo mínimo
  if (response.status === 400 && full) return callGemini(model, prompt, key, timeout, false);
  return { status: response.status, data };
}

async function handler(req: Request) {
  if (req.method !== "POST") return reply(405, { error: "bad_request" });
  const token = env("SENTENCE_REVIEW_TOKEN") || "";
  if (!sameToken(req.headers.get("x-review-token") || "", token)) return reply(401, { error: "unauthorized" });

  const keys = apiKeys();
  if (!keys.length) return reply(500, { error: "not_configured" });
  const params = readReviewParams(await req.json().catch(() => null));
  if (!params) return reply(400, { error: "bad_request" });

  const prompt = renderReviewPrompt(params);
  // Cada clave con el modelo principal y, si todas fallan, con el de reserva.
  // Solo se pasa a la siguiente cuando el fallo es de cuota, de clave o del servicio.
  const models = FALLBACK_MODEL && FALLBACK_MODEL !== MODEL ? [MODEL, FALLBACK_MODEL] : [MODEL];
  let model = MODEL;
  let result: { status: number; data: any } = { status: 0, data: {} };
  const started = Date.now();
  search:
  for (model of models) {
    for (const entry of keys) {
      const left = BUDGET_MS - (Date.now() - started);
      if (left < 5000) break search;
      result = await callGemini(model, prompt, entry.key, Math.min(ATTEMPT_MS, left));
      if (![401, 403, 408, 429, 500, 503].includes(result.status)) break search;
    }
  }
  const candidate = result.data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p: any) => p.text || "").join("");
  if ([401, 403, 429].includes(result.status)) return reply(503, { error: "quota" });
  if (result.status === 408 || result.status === 0) return reply(504, { error: "timeout" });
  if (result.status !== 200 || !text) {
    return reply(502, { error: "provider", detail: `${result.status} ${candidate?.finishReason || ""}`.trim() });
  }
  if (candidate?.finishReason === "MAX_TOKENS") return reply(502, { error: "truncated" });
  return reply(200, { text, model, promptVersion: REVIEW_PROMPT_VERSION });
}

if (typeof Deno !== "undefined") Deno.serve(handler);
