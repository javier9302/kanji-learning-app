// =========================================
// KANJI LEARNING APP - Edge Function "summarize-progress"
// Escribe con Gemini un resumen breve de la semana del estudiante premium a
// partir de los números que ya calculó la app (progress.js): nada se calcula
// aquí ni lo calcula la IA, solo lo cuenta. Uno por usuario, semana e idioma:
// se guarda en progress_summaries y, si ya está, se devuelve sin llamar a la IA.
//
// Petición: { week: "2026-W43", lang: "es" | "en", facts }
//   facts  { levels, delta, reading, practice, roadmap, grammarNext } (ver readSummaryParams)
// Respuesta: { summary, cached }
//
// Secretos (Supabase -> Edge Functions -> Secrets), los mismos que generate-text:
//   GEMINI_API_KEYS / GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL
// y, opcional:
//   SUMMARY_DAILY_CALLS   llamadas a la IA por usuario y día, vayan bien o mal (por defecto 5)
// Cada llamada queda en summary_generations.
// =========================================

// Lo que depende de Deno va protegido para que las pruebas puedan importar este archivo desde Node.
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
const env = (name: string): string | undefined => typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
let createClient: any = null;

const MODEL = env("GEMINI_MODEL") || "gemini-3.8-flash";
const FALLBACK_MODEL = env("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
const PROMPT_VERSION = "2026-10-22.1";
const MAX_SUMMARY = 900;          // caracteres del resumen que se guardan

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const STEP_KINDS = ["vocab", "kanji", "grammar", "easier", "read", "habit"];
const GRAMMAR_JA = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〜・＋]{1,20}$/u;
const GRAMMAR_EN = /^[\p{Script=Latin}\p{Script=Hiragana}0-9 ,.:;'’()…?\/-]{1,60}$/u;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* Un número entero dentro de un rango, o null */
const int = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : null;
const level = (value: unknown) => LEVELS.includes(value as string) ? value as string : null;
const estimate = (value: any) => value && typeof value === "object"
  ? { done: level(value.done), current: level(value.current), percent: int(value.percent, 0, 100) } : null;

/* Solo se aceptan números y valores conocidos: la función no es un chat libre */
export function readSummaryParams(body: any) {
  if (!body || !/^\d{4}-W\d{2}$/.test(body.week) || !["es", "en"].includes(body.lang) || !body.facts) return null;
  const facts = body.facts;
  const delta = facts.delta && typeof facts.delta === "object" ? {
    words: int(facts.delta.words, -9999, 9999), kanji: int(facts.delta.kanji, -9999, 9999),
    grammar: int(facts.delta.grammar, -999, 999), texts: int(facts.delta.texts, -999, 999),
  } : null;
  return {
    week: body.week as string, lang: body.lang as string,
    facts: {
      levels: {
        vocab: estimate(facts.levels?.vocab), kanji: estimate(facts.levels?.kanji),
        grammar: estimate(facts.levels?.grammar), texts: level(facts.levels?.texts),
      },
      changeSinceLastWeek: delta,
      reading: {
        textsRead: int(facts.reading?.texts, 0, 99999), textsLast30Days: int(facts.reading?.texts30, 0, 9999),
        knownInLatestTextsPercent: int(facts.reading?.coverage, 0, 100), lookupsPer100Words: int(facts.reading?.lookups, 0, 100),
      },
      practice: {
        activeDaysOf30: int(facts.practice?.activeDays, 0, 30), reviews30: int(facts.practice?.reviews, 0, 99999),
        accuracyPercent: int(facts.practice?.accuracy, 0, 100),
      },
      weeklyGoals: (Array.isArray(facts.roadmap) ? facts.roadmap : []).slice(0, 6)
        .filter((step: any) => step && STEP_KINDS.includes(step.kind))
        .map((step: any) => ({ kind: step.kind, level: level(step.level), count: int(step.count, 0, 999), missing: int(step.missing, 0, 9999) })),
      grammarToPractise: (Array.isArray(facts.grammarNext) ? facts.grammarNext : []).slice(0, 3)
        .filter((point: any) => point && GRAMMAR_JA.test(point.ja) && GRAMMAR_EN.test(point.en))
        .map((point: any) => ({ ja: point.ja, en: point.en })),
    },
  };
}

/* El prompt: solo los hechos, en JSON, y cómo contarlos */
export function renderSummaryPrompt({ lang, facts }: any) {
  const language = lang === "es" ? "Spanish (use «tú»)" : "English";
  return `You are a warm, concise Japanese tutor. Write a short summary of this learner's progress for this week in ${language}.

RULES
- 3 to 5 sentences, under 90 words, plain text: no markdown, no lists, no headings, no emojis.
- Use ONLY the facts below. Never invent numbers, words or dates. If a fact is null, do not mention it.
- Levels are JLPT levels (N5 is the easiest). "done" is the last level the learner has completed in that area; "current" is the one in progress, with "percent" of it known.
- Say one thing that went well, the main thing to work on next (the first weekly goal) and one concrete action for this week.
- Weekly goal kinds: vocab = new words, kanji = new kanji, grammar = grammar points, easier = the texts are too hard (read easier ones), read = read more texts, habit = study on more days.

FACTS (JSON)
${JSON.stringify(facts)}`;
}

/* Lo que devuelve la IA, limpio: sin markdown y con un largo máximo */
export function cleanSummary(text: string) {
  return String(text || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
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
  const generationConfig: Record<string, unknown> = {};
  if (full) Object.assign(generationConfig, { maxOutputTokens: 1200, temperature: 0.6, thinkingConfig: { thinkingLevel: "low" } });
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

  const params = readSummaryParams(await req.json().catch(() => null));
  if (!params) return reply(400, { error: "bad_request" });

  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY")!);
  // Ya escrito esta semana en este idioma: se devuelve sin llamar a la IA
  const { data: saved, error: savedError } = await admin.from("progress_summaries").select("summary")
    .eq("user_id", user.id).eq("week", params.week).eq("lang", params.lang).maybeSingle();
  if (savedError) return reply(500, { error: "not_configured", detail: savedError.message });
  if (saved) return reply(200, { summary: saved.summary, cached: true });

  // Solo premium (se lee en el servidor: la app no puede decidirlo)
  const { data: profile } = await admin.from("profiles").select("plan, plan_until").eq("user_id", user.id).maybeSingle();
  const premium = profile?.plan === "premium" && (!profile.plan_until || Date.parse(profile.plan_until) > Date.now());
  if (!premium) return reply(403, { error: "premium" });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count } = await admin.from("summary_generations").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", today.toISOString());
  if ((count || 0) >= (Number(env("SUMMARY_DAILY_CALLS")) || 5)) return reply(429, { error: "busy" });

  const prompt = renderSummaryPrompt(params);
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
  const summary = cleanSummary((candidate?.content?.parts || []).map((p: any) => p.text || "").join(""));
  const usage = result.data?.usageMetadata || {};
  const failure = [401, 403, 429].includes(result.status) ? "quota"
    : result.status !== 200 ? "provider" : summary.length < 20 ? "empty" : "";

  await admin.from("summary_generations").insert({
    user_id: user.id, ok: !failure, result: failure || "ok", model, key_label: label,
    attempts: attempts.join(" ") || null, prompt_version: PROMPT_VERSION,
    prompt_tokens: usage.promptTokenCount ?? null, output_tokens: usage.candidatesTokenCount ?? null,
    error: failure ? `${failure}: ${result.status} ${JSON.stringify(result.data?.error?.message || "").slice(0, 300)}` : null,
  });
  if (failure) return reply(failure === "quota" ? 503 : 502, { error: failure });

  await admin.from("progress_summaries").upsert({
    user_id: user.id, week: params.week, lang: params.lang, summary, model, prompt_version: PROMPT_VERSION,
  }, { onConflict: "user_id,week,lang" });
  return reply(200, { summary, cached: false });
}

if (typeof Deno !== "undefined") {
  // @ts-ignore: "npm:" lo resuelve Deno en Supabase; el editor (TypeScript normal) no lo conoce
  ({ createClient } = await import("npm:@supabase/supabase-js@2"));
  Deno.serve(handler);
}
