/* =========================================
   KANJI LEARNING APP - notify.js
   Ajustes → Avisos de repaso: un aviso en el móvil o el ordenador cuando se
   junta un grupo de palabras que repasar, aunque la app esté cerrada (Web Push).
   Este archivo solo suscribe el dispositivo: guarda en push_subscriptions la
   dirección que da el navegador, su zona horaria, su idioma y cada cuántas
   palabras avisar (prefs.notifyMin). Quien cuenta y avisa es el servidor
   (Edge Function notify-due, cada hora), con lo último sincronizado. Por eso
   hace falta cuenta. El aviso lo muestra sw.js (eventos push y notificationclick).
   En iPhone y iPad solo funciona con la app añadida a la pantalla de inicio.
   Se carga antes de app.js.
   ========================================= */

const notifyState = { busy: false, subscribed: false, refreshed: false };

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/* La clave pública VAPID llega en base64 de URL; pushManager.subscribe la quiere en bytes */
function vapidBytes(base64) {
  const padded = (base64 + "=".repeat((4 - base64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const pushSubscription = async () => pushSupported()
  ? (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null : null;

/* La fila del dispositivo, con lo de ahora (zona horaria, idioma, cada cuántas) */
async function savePushRow(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({
    endpoint, p256dh: keys.p256dh, auth: keys.auth, user_id: sync.user.id,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    min_due: Number(prefs.notifyMin) || 10, lang
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

function notifySay(text, kind = "") {
  $("notifyMessage").textContent = text;
  $("notifyMessage").className = `message ${kind}`;
}

async function renderNotify() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const subscription = await pushSubscription().catch(() => null);
  notifyState.subscribed = !!subscription && !!sync.user;
  const help = !sb ? t("Los avisos necesitan las cuentas, que no están configuradas en esta instalación.")
    : !pushSupported() ? (ios && !standalone
      ? t("En iPhone o iPad, los avisos solo funcionan con la app añadida a la pantalla de inicio (mira «Instalar la app»).")
      : t("Este navegador no permite avisos."))
    : !sync.user ? t("Inicia sesión para recibir avisos: el servidor cuenta tus repasos con lo que sincronizas.")
    : Notification.permission === "denied" ? t("Has bloqueado los avisos de esta página. Permítelos en los ajustes del navegador y vuelve aquí.")
    : notifyState.subscribed ? t("Activados en este dispositivo. Te avisaremos entre las 9:00 y las 21:00, como mucho una vez por grupo.")
    : t("Un aviso cuando se junten palabras que repasar, aunque la app esté cerrada.");
  $("notifyHelp").textContent = help;
  const usable = !!sb && pushSupported() && !!sync.user && Notification.permission !== "denied";
  $("notifyOnBtn").classList.toggle("hidden", !usable || notifyState.subscribed);
  $("notifyTestBtn").classList.toggle("hidden", !notifyState.subscribed);
  $("notifyOffBtn").classList.toggle("hidden", !notifyState.subscribed);
  $("notifyMinSelect").classList.toggle("hidden", !usable);
  $("notifyMinSelect").value = String(prefs.notifyMin);
  for (const button of [$("notifyOnBtn"), $("notifyTestBtn"), $("notifyOffBtn")]) button.disabled = notifyState.busy;
  // Si cambió el idioma o la zona horaria desde que se activó, la fila se pone al día (una vez por visita)
  if (notifyState.subscribed && !notifyState.refreshed) {
    notifyState.refreshed = true;
    savePushRow(subscription).catch(() => {});
  }
}

async function notifyBusy(work) {
  notifyState.busy = true;
  renderNotify();
  try { await work(); } catch (error) {
    console.error("Avisos:", error);
    notifySay(t("No se pudo: {error}", { error: error.message || error }), "incorrect");
  }
  notifyState.busy = false;
  renderNotify();
}

const enableNotify = () => notifyBusy(async () => {
  if (await Notification.requestPermission() !== "granted") return notifySay(t("Sin permiso no se pueden enviar avisos."), "incorrect");
  const { data, error } = await sb.functions.invoke("notify-due", { method: "GET" });
  if (error || !data?.publicKey) throw error || new Error("notify-due");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() ||
    await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(data.publicKey) });
  await savePushRow(subscription);
  notifySay(t("Avisos activados."), "correct");
});

const testNotify = () => notifyBusy(async () => {
  const { data, error } = await sb.functions.invoke("notify-due", { body: { test: true } });
  if (error) throw error;
  notifySay(data?.sent ? t("Enviado: llegará en unos segundos.") : t("No se pudo enviar. Desactívalos y vuelve a activarlos."), data?.sent ? "correct" : "incorrect");
});

/* Quitar la suscripción: la del navegador y su fila. Al cerrar sesión también,
   para que este dispositivo no reciba los avisos de otra cuenta. */
async function removeNotify() {
  const subscription = await pushSubscription().catch(() => null);
  if (!subscription) return;
  if (sync.user) await sb.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

const disableNotify = () => notifyBusy(async () => {
  await removeNotify();
  notifySay(t("Avisos desactivados en este dispositivo."));
});

function bindNotify() {
  $("notifyOnBtn").addEventListener("click", enableNotify);
  $("notifyTestBtn").addEventListener("click", testNotify);
  $("notifyOffBtn").addEventListener("click", disableNotify);
  $("notifyMinSelect").addEventListener("change", (event) => {
    prefs.notifyMin = Number(event.target.value);
    saveLocal("kanji-prefs", prefs);
    if (notifyState.subscribed) pushSubscription().then((subscription) => subscription && savePushRow(subscription)).catch(() => {});
  });
}
