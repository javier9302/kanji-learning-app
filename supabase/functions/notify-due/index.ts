// =========================================
// KANJI LEARNING APP - Edge Function "notify-due"
// Avisa en el móvil (Web Push) cuando se juntan palabras que repasar. La llama
// cada hora una tarea programada de la base de datos (pg_cron + pg_net, ver
// SETUP.md) con la cabecera x-cron-secret (el valor de push_config.cron_secret). También:
//   GET               devuelve la clave pública (VAPID) con la que la app se suscribe
//   POST {test:true}  con la sesión del usuario: un aviso de prueba a sus dispositivos
// No necesita secretos: las claves VAPID se crean la primera vez y se guardan en
// la tabla push_config, que solo puede leer el servidor. La verificación de JWT
// va DESACTIVADA (la tarea programada no tiene sesión); la prueba la comprueba aquí.
//
// Cuándo se avisa (shouldNotify): con al menos min_due palabras que tocan, entre
// las 9 y las 21 de su hora, y solo si desde el último aviso se ha juntado otro
// grupo (min_due más) o es otro día. Así nunca llega más de un aviso por grupo.
// =========================================

// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
const env = (name: string): string | undefined => typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
let createClient: any = null, webpush: any = null;

export const HOURS = { from: 9, to: 21 }; // de las 9:00 a las 20:59 de su hora

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ¿Hay que avisar? row: una fila de push_due_counts():
     { due, min_due, local_hour, local_day, last_sent_at, last_day, last_count } */
export function shouldNotify(row: any) {
  if (!(row.due >= row.min_due)) return false;
  if (row.local_hour < HOURS.from || row.local_hour >= HOURS.to) return false;
  if (!row.last_sent_at || row.last_day !== row.local_day) return true;  // el primero del día
  return row.due >= (row.last_count || 0) + row.min_due;                 // se ha juntado otro grupo
}

/* El aviso, en su idioma */
export function message(due: number, lang: string, test = false) {
  if (lang === "en") {
    return test
      ? { title: "Notifications are on", body: "You'll get a message like this when words are waiting for review.", url: "./" }
      : { title: `${due} words to review`, body: "Open the app and review them while you still remember them.", url: "./" };
  }
  return test
    ? { title: "Los avisos funcionan", body: "Te llegará un mensaje así cuando tengas palabras que repasar.", url: "./" }
    : { title: `Tienes ${due} palabras para repasar`, body: "Abre la app y repásalas ahora, que aún las recuerdas.", url: "./" };
}

/* Las claves VAPID: las de push_config o, la primera vez, unas nuevas */
async function vapidKeys(admin: any) {
  const { data } = await admin.from("push_config").select("vapid_public, vapid_private").eq("id", 1).maybeSingle();
  if (data) return { publicKey: data.vapid_public, privateKey: data.vapid_private };
  const keys = webpush.generateVAPIDKeys();
  // Si otra petición las creó a la vez, gana la primera (on conflict do nothing) y se vuelven a leer
  await admin.from("push_config").upsert({ id: 1, vapid_public: keys.publicKey, vapid_private: keys.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  const { data: saved } = await admin.from("push_config").select("vapid_public, vapid_private").eq("id", 1).single();
  return { publicKey: saved.vapid_public, privateKey: saved.vapid_private };
}

/* Envía un aviso. Una suscripción que ya no existe (404/410) se borra. Devuelve si llegó al servicio. */
async function send(admin: any, sub: any, payload: any) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 * 6 });
    return true;
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    else console.error("No se pudo enviar el aviso:", error?.statusCode, error?.body || error?.message);
    return false;
  }
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = env("SUPABASE_URL")!;
  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY")!);
  const keys = await vapidKeys(admin);
  if (req.method === "GET") return reply(200, { publicKey: keys.publicKey });
  if (req.method !== "POST") return reply(405, { error: "bad_request" });
  webpush.setVapidDetails("mailto:avisos@kanji-learning-app.invalid", keys.publicKey, keys.privateKey);
  const body = await req.json().catch(() => ({}));

  // Prueba: solo a los dispositivos de quien la pide
  if (body?.test) {
    const userClient = createClient(url, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return reply(401, { error: "unauthorized" });
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", auth.user.id);
    let sent = 0;
    for (const sub of subs || []) if (await send(admin, sub, message(0, sub.lang, true))) sent++;
    return reply(200, { sent, devices: (subs || []).length });
  }

  // La tarea programada: con el secreto de push_config
  const { data: valid } = await admin.rpc("check_cron_secret", { secret: req.headers.get("x-cron-secret") || "" });
  if (!valid) return reply(401, { error: "unauthorized" });
  const { data: rows, error } = await admin.rpc("push_due_counts");
  if (error) return reply(500, { error: "not_configured", detail: error.message });
  let sent = 0;
  for (const row of rows || []) {
    if (!shouldNotify(row)) continue;
    if (await send(admin, row, message(row.due, row.lang))) {
      sent++;
      await admin.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), last_count: row.due }).eq("endpoint", row.endpoint);
    }
  }
  return reply(200, { checked: (rows || []).length, sent });
}

if (typeof Deno !== "undefined") {
  // @ts-ignore: "npm:" lo resuelve Deno en Supabase; el editor (TypeScript normal) no lo conoce
  ({ createClient } = await import("npm:@supabase/supabase-js@2"));
  // @ts-ignore: igual
  webpush = (await import("npm:web-push@3.6.7")).default;
  Deno.serve(handler);
}
