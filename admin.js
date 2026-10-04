/* =========================================
   KANJI LEARNING APP - admin.js
   Página de administración (admin.html): revisar los textos que suben
   los usuarios y aprobarlos o rechazarlos.
   Quién es administrador lo decide la base de datos (tabla admins y
   Row Level Security); esta página solo muestra lo que el servidor permite.
   ========================================= */

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

const STATUS_LABEL = { pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado" };
const PAGE = 100;

const configured = typeof SUPABASE_CONFIG === "object" && !SUPABASE_CONFIG.url.includes("TU-PROYECTO");
const sb = configured && window.supabase
  ? window.supabase.createClient(new URL(SUPABASE_CONFIG.url).origin, SUPABASE_CONFIG.anonKey)
  : null;

let status = "pending";
let rows = [];
let openId = "";

function say(text, isError = false) {
  $("adminMessage").textContent = text;
  $("adminMessage").className = `message ${isError ? "incorrect" : ""}`;
}

function show(section) {
  $("adminLogin").classList.toggle("hidden", section !== "login");
  $("adminPanel").classList.toggle("hidden", section !== "panel");
}

/* Con sesión: comprueba el permiso y muestra el panel o el motivo */
async function enter(user) {
  $("adminUser").textContent = user.email;
  $("adminSignOutBtn").classList.remove("hidden");
  const { data, error } = await sb.rpc("is_admin");
  if (error) {
    show("");
    return say(`No se pudo comprobar el permiso (${error.message}). ¿Ejecutaste supabase/schema.sql?`, true);
  }
  if (!data) {
    show("");
    return say("Esta cuenta no tiene permiso de administración.", true);
  }
  say("");
  show("panel");
  await loadTexts();
}

async function loadTexts() {
  $("adminList").innerHTML = `<p class="message">Cargando…</p>`;
  const { data, error } = await sb.from("texts")
    .select("id, title, title_es, title_en, topic, level, source, status, data, total, created_at, user_id")
    .eq("status", status).is("deleted_at", null)
    .order("created_at", { ascending: status === "pending" }).limit(PAGE);
  if (error) {
    $("adminList").innerHTML = "";
    return say(`No se pudieron cargar los textos (${error.message}).`, true);
  }
  rows = data;
  render();
}

function render() {
  $("adminCount").textContent = `${rows.length}${rows.length === PAGE ? "+" : ""} ${
    STATUS_LABEL[status].toLowerCase()}${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    $("adminList").innerHTML = `<div class="no-items">No hay textos en este estado.</div>`;
    return;
  }
  $("adminList").innerHTML = rows.map((row) => {
    const open = row.id === openId;
    const date = new Date(row.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
    return `
    <article class="admin-text">
      <div class="item-row">
        <div class="item-info">
          <div class="item-title" lang="ja">${escapeHTML(row.title)}</div>
          <div class="item-sub">
            ${escapeHTML(row.title_es)} · ${escapeHTML(row.level)} · ${escapeHTML(row.topic)} ·
            ${row.total} palabras · ${date} · ${escapeHTML(row.source)} · usuario ${escapeHTML(row.user_id.slice(0, 8))}
          </div>
        </div>
        <button class="button button-outline" type="button" data-open="${escapeHTML(row.id)}">${open ? "Ocultar" : "Ver texto"}</button>
        ${status !== "approved" ? `<button class="button button-good" type="button" data-set="approved" data-id="${escapeHTML(row.id)}">Aprobar</button>` : ""}
        ${status !== "rejected" ? `<button class="button button-wrong" type="button" data-set="rejected" data-id="${escapeHTML(row.id)}">Rechazar</button>` : ""}
      </div>
      ${open ? `
      <div class="admin-body">
        ${(row.data?.sentences || []).map((sentence) => `
          <p lang="ja">${escapeHTML(sentence.jp)}</p>
          <p class="helper">${escapeHTML(sentence.es)}</p>`).join("")}
      </div>` : ""}
    </article>`;
  }).join("");
}

async function setStatus(id, value) {
  const { data, error } = await sb.from("texts").update({ status: value }).eq("id", id).select("id, status");
  if (error) return say(`No se pudo cambiar el estado (${error.message}).`, true);
  // Si la base de datos ignoró el cambio, la cuenta no es administradora
  if (!data.length || data[0].status !== value) return say("El servidor no aceptó el cambio de estado.", true);
  say(`Texto ${STATUS_LABEL[value].toLowerCase()}.`);
  rows = rows.filter((row) => row.id !== id);
  render();
}

function bind() {
  $("adminForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("adminSubmitBtn").disabled = true;
    say("Un momento…");
    const { error } = await sb.auth.signInWithPassword({
      email: $("adminEmail").value.trim(), password: $("adminPassword").value
    });
    $("adminSubmitBtn").disabled = false;
    if (error) say(error.code === "invalid_credentials" ? "Correo o contraseña incorrectos." : error.message, true);
  });

  $("adminSignOutBtn").addEventListener("click", () => sb.auth.signOut({ scope: "local" }));

  document.querySelector(".subtabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-status]");
    if (!tab) return;
    status = tab.dataset.status;
    openId = "";
    document.querySelectorAll(".subtab").forEach((t) => t.classList.toggle("active", t === tab));
    loadTexts();
  });

  $("adminList").addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) {
      openId = openId === open.dataset.open ? "" : open.dataset.open;
      return render();
    }
    const set = event.target.closest("[data-set]");
    if (set) {
      set.disabled = true;
      setStatus(set.dataset.id, set.dataset.set);
    }
  });

  let current = "";
  // Supabase no permite llamar a su API dentro de este aviso: se aplaza
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => {
    const user = session?.user || null;
    if ((user?.id || "") === current && event !== "INITIAL_SESSION") return;
    current = user?.id || "";
    if (user) return enter(user);
    $("adminUser").textContent = "";
    $("adminSignOutBtn").classList.add("hidden");
    say("");
    show("login");
  }, 0));
}

if (sb) bind();
else say("Falta configurar Supabase en config.js, o no se pudo cargar el servicio de cuentas.", true);
