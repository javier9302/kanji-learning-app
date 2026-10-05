// =========================================
// KANJI LEARNING APP - Edge Function "notify-admin"
// Avisa por correo al administrador cuando llega un texto nuevo pendiente.
// La llama un Database Webhook de Supabase (INSERT en la tabla texts);
// ver SETUP.md. El correo se envía con Resend (https://resend.com).
//
// Secretos (Supabase -> Edge Functions -> Secrets):
//   RESEND_API_KEY   clave de Resend
//   ADMIN_EMAIL      a quién avisar
//   ADMIN_URL        dirección de admin.html (para el enlace del correo)
//   NOTIFY_FROM      opcional, remitente (por defecto el de pruebas de Resend)
// =========================================

const escapeHTML = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ADMIN_EMAIL");
  if (!key || !to) return new Response("Faltan RESEND_API_KEY o ADMIN_EMAIL", { status: 500 });

  const payload = await req.json().catch(() => null);
  const text = payload?.record;
  // Solo interesan los textos nuevos que esperan aprobación
  if (payload?.type !== "INSERT" || payload?.table !== "texts" || text?.status !== "pending") {
    return new Response("ignorado", { status: 200 });
  }

  const link = Deno.env.get("ADMIN_URL") || "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("NOTIFY_FROM") || "Kanji Learning App <onboarding@resend.dev>",
      to: [to],
      subject: `Nuevo texto pendiente: ${String(text.title).slice(0, 80)}`,
      html: `<p>Hay un texto nuevo esperando aprobación.</p>
        <p><strong>${escapeHTML(text.title)}</strong> · ${escapeHTML(text.title_es)}<br>
        Nivel ${escapeHTML(text.level)} · ${escapeHTML(text.topic)} · ${escapeHTML(text.total)} palabras ·
        origen: ${escapeHTML(text.source)}</p>
        ${link ? `<p><a href="${escapeHTML(link)}">Abrir el panel de administración</a></p>` : ""}`,
    }),
  });
  return new Response(response.ok ? "enviado" : await response.text(), { status: response.ok ? 200 : 502 });
});
