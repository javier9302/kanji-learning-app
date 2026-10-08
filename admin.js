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
let section = "texts"; // texts | words
let wordRows = [];
let editingWord = 0;   // id de la palabra que se está editando

const SOURCE_LABEL = {
  jmdict: "Del diccionario JMdict", ai: "Solo la explicó la IA", kana_fix: "Se pasó de kanji a kana"
};

function say(text, isError = false) {
  $("adminMessage").textContent = text;
  $("adminMessage").className = `message ${isError ? "incorrect" : ""}`;
}

function show(view) {
  $("adminLogin").classList.toggle("hidden", view !== "login");
  $("adminTabs").classList.toggle("hidden", view !== "panel");
  $("adminPanel").classList.toggle("hidden", view !== "panel" || section !== "texts");
  $("wordsPanel").classList.toggle("hidden", view !== "panel" || section !== "words");
  $("logsPanel").classList.toggle("hidden", view !== "panel" || section !== "logs");
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

/* ---------- Palabras por revisar ---------- */

async function loadWords() {
  $("wordsList").innerHTML = `<p class="message">Cargando…</p>`;
  const { data, error } = await sb.from("words_to_review").select("*")
    .eq("status", "pending").order("created_at").limit(PAGE);
  if (error) {
    $("wordsList").innerHTML = "";
    return say(`No se pudieron cargar las palabras (${error.message}). ¿Ejecutaste supabase/schema.sql?`, true);
  }
  wordRows = data;
  renderWords();
}

const list = (value) => (Array.isArray(value) ? value : []).join(", ");
const split = (value) => value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);

function renderWords() {
  $("wordsCount").textContent = `${wordRows.length}${wordRows.length === PAGE ? "+" : ""} pendiente${wordRows.length === 1 ? "" : "s"}`;
  if (!wordRows.length) {
    $("wordsList").innerHTML = `<div class="no-items">No hay palabras por revisar.</div>`;
    return;
  }
  $("wordsList").innerHTML = wordRows.map((row) => row.id === editingWord ? `
    <article class="item-row admin-word editing">
      <div class="item-symbol word-symbol" lang="ja">${escapeHTML(row.lemma)}</div>
      <div class="item-info admin-edit">
        <label>Lectura <input class="search" data-field="reading" value="${escapeHTML(row.reading)}" lang="ja"></label>
        <label>Significado (inglés) <input class="search" data-field="meanings" value="${escapeHTML(list(row.meanings))}"></label>
        <label>Significado (español) <input class="search" data-field="meanings_es" value="${escapeHTML(list(row.meanings_es))}"></label>
      </div>
      <button class="button button-primary" type="button" data-word="save" data-id="${row.id}">Guardar</button>
      <button class="button button-quiet" type="button" data-word="cancel" data-id="${row.id}">Cancelar</button>
    </article>` : `
    <article class="item-row admin-word">
      <div class="item-symbol word-symbol" lang="ja">${escapeHTML(row.lemma)}</div>
      <div class="item-info">
        <div class="item-title"><span lang="ja">${escapeHTML(row.reading || "—")}</span> ·
          ${escapeHTML(list(row.meanings_es) || "sin español")} · ${escapeHTML(list(row.meanings) || "sin inglés")}</div>
        <div class="item-sub">${SOURCE_LABEL[row.source] || escapeHTML(row.source)} ·
          <span lang="ja">${escapeHTML(row.sentence || "")}</span></div>
      </div>
      <button class="button button-good" type="button" data-word="approve" data-id="${row.id}">Aprobar</button>
      <button class="button button-outline" type="button" data-word="edit" data-id="${row.id}">Editar</button>
      <button class="button button-wrong" type="button" data-word="discard" data-id="${row.id}">Descartar</button>
    </article>`).join("");
}

async function wordAction(action, id, card) {
  const row = wordRows.find((w) => w.id === id);
  if (!row) return;
  if (action === "edit") { editingWord = id; return renderWords(); }
  if (action === "cancel") { editingWord = 0; return renderWords(); }

  if (action === "save") {
    const value = (field) => card.querySelector(`[data-field="${field}"]`).value;
    const changes = { reading: value("reading").trim(), meanings: split(value("meanings")), meanings_es: split(value("meanings_es")) };
    const { error } = await sb.from("words_to_review").update(changes).eq("id", id);
    if (error) return say(`No se pudo guardar (${error.message}).`, true);
    Object.assign(row, changes);
    editingWord = 0;
    say("Cambios guardados. Falta aprobarla para que entre en el diccionario.");
    return renderWords();
  }

  if (action === "approve") {
    if (!row.reading) return say("Antes de aprobarla, edítala y escribe su lectura.", true);
    // Entra en el diccionario; si llegó con kanji y se pasó a kana, queda marcada como "en kana"
    const { error } = await sb.from("dictionary").upsert({
      lemma: row.lemma, reading: row.reading, meanings: row.meanings, meanings_es: row.meanings_es,
      uk: row.source === "kana_fix", source: "approved", updated_at: new Date().toISOString()
    }, { onConflict: "lemma,reading" });
    if (error) return say(`No se pudo guardar en el diccionario (${error.message}).`, true);
  }

  const next = action === "approve" ? "approved" : "discarded";
  const { error } = await sb.from("words_to_review")
    .update({ status: next, reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) return say(`No se pudo actualizar la palabra (${error.message}).`, true);
  say(action === "approve" ? `「${row.lemma}」 aprobada y guardada en el diccionario.` : `「${row.lemma}」 descartada.`);
  wordRows = wordRows.filter((w) => w.id !== id);
  renderWords();
}

/* ---------- Registros de generación y reportes ---------- */

const RESULT_LABEL = {
  ok: "Correcto", invalid_json: "JSON inválido", missing_fields: "Faltan campos", tokens_mismatch: "Los tokens no coinciden con el texto",
  empty_units: "Unidades vacías en la segmentación", too_short: "Texto demasiado corto", truncated: "Respuesta cortada", empty: "Respuesta vacía", provider: "Error del servicio", quota: "Sin cuota"
};
const REPORT_LABEL = {
  repaired: "Arreglado por la app", translation: "Traducción incorrecta", reading: "Lectura incorrecta",
  tokens: "Palabras mal separadas", difficulty: "Demasiado difícil", other: "Otro"
};

/* Todas las filas de una tabla, de mil en mil */
async function fetchAll(table) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order("created_at").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

async function loadLogs() {
  $("logsList").innerHTML = `<p class="message">Cargando…</p>`;
  const [failed, reports, total] = await Promise.all([
    sb.from("generations").select("created_at, model, prompt_version, result, error, params, attempt")
      .neq("result", "ok").order("created_at", { ascending: false }).limit(15),
    sb.from("text_reports").select("*").order("created_at", { ascending: false }).limit(15),
    sb.from("generations").select("id", { count: "exact", head: true })
  ]);
  if (failed.error || reports.error) {
    $("logsList").innerHTML = "";
    return say(`No se pudieron cargar los registros (${(failed.error || reports.error).message}). ¿Ejecutaste supabase/schema.sql?`, true);
  }
  $("logsCount").textContent = `${total.count ?? 0} generaciones`;
  const date = (iso) => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const rowsHTML = [
    ...failed.data.map((row) => ({ at: row.created_at, html: `
      <article class="item-row">
        <div class="item-info">
          <div class="item-title">${escapeHTML(RESULT_LABEL[row.result] || row.result || "Fallo")} · intento ${row.attempt}</div>
          <div class="item-sub">${date(row.created_at)} · ${escapeHTML(row.model)} · prompt ${escapeHTML(row.prompt_version || "—")} ·
            ${escapeHTML(row.params?.level || "")} ${escapeHTML(row.params?.topic || "")} · ${escapeHTML((row.error || "").slice(0, 160))}</div>
        </div>
      </article>` })),
    ...reports.data.map((row) => ({ at: row.created_at, html: `
      <article class="item-row">
        <div class="item-info">
          <div class="item-title">${row.kind === "user" ? "⚑ Reporte" : "Arreglo automático"}: ${escapeHTML(REPORT_LABEL[row.category] || row.category)}
            · <span lang="ja">${escapeHTML(row.details?.title || "")}</span></div>
          <div class="item-sub">${date(row.created_at)} · prompt ${escapeHTML(row.prompt_version || "—")} ·
            ${escapeHTML(row.comment || (row.details?.repairs || []).slice(0, 4).join("; "))}</div>
        </div>
      </article>` }))
  ].sort((a, b) => b.at.localeCompare(a.at));
  $("logsList").innerHTML = rowsHTML.length ? rowsHTML.map((row) => row.html).join("")
    : `<div class="no-items">No hay fallos ni reportes todavía.</div>`;
}

async function exportLogs() {
  const button = $("logsExportBtn");
  button.disabled = true;
  try {
    say("Preparando la exportación…");
    const [generations, reports] = await Promise.all([fetchAll("generations"), fetchAll("text_reports")]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), generations, reports }, null, 2)],
      { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `registros-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    say(`Exportados ${generations.length} registros de generación y ${reports.length} reportes.`);
  } catch (error) {
    say(`No se pudo exportar (${error.message}).`, true);
  } finally {
    button.disabled = false;
  }
}

/* ---------- Diccionario general ---------- */

async function dictionaryCount() {
  const { count, error } = await sb.from("dictionary").select("id", { count: "exact", head: true });
  if (!error) $("dictInfo").textContent = `El diccionario tiene ${count} palabras. Importar de nuevo no duplica nada ni pisa lo que hayas aprobado.`;
}

/* Sube supabase/dictionary.json a la tabla "dictionary", por tandas */
async function importDictionary() {
  const button = $("dictImportBtn");
  button.disabled = true;
  try {
    say("Descargando el diccionario…");
    const entries = await (await fetch("supabase/dictionary.json")).json();
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const rows = entries.slice(i, i + BATCH).map(([lemma, reading, meanings, meanings_es, uk]) =>
        ({ lemma, reading, meanings, meanings_es, uk: !!uk, source: "jmdict" }));
      const { error } = await sb.from("dictionary").upsert(rows, { onConflict: "lemma,reading", ignoreDuplicates: true });
      if (error) throw error;
      say(`Importando el diccionario… ${Math.min(i + BATCH, entries.length)} / ${entries.length}`);
    }
    say(`Diccionario importado: ${entries.length} palabras.`);
    dictionaryCount();
  } catch (error) {
    say(`No se pudo importar el diccionario (${error.message}). Puedes volver a pulsar el botón: continúa donde se quedó.`, true);
  } finally {
    button.disabled = false;
  }
}

function bind() {
  $("dictImportBtn").addEventListener("click", importDictionary);
  $("logsExportBtn").addEventListener("click", exportLogs);
  $("adminTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-admin]");
    if (!tab) return;
    section = tab.dataset.admin;
    document.querySelectorAll("[data-admin]").forEach((t) => t.classList.toggle("active", t === tab));
    say("");
    show("panel");
    if (section === "words") { loadWords(); dictionaryCount(); }
    else if (section === "logs") loadLogs();
    else loadTexts();
  });

  $("wordsList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-word]");
    if (button) wordAction(button.dataset.word, Number(button.dataset.id), button.closest(".admin-word"));
  });

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
