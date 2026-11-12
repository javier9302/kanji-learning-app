/* =========================================
   KANJI LEARNING APP - kana.js
   Hiragana y katakana: el camino de quien empieza de cero (reglas en
   kana-core.js). Cada lección repasa las kanas que vencen y enseña una fila
   nueva (あいうえお); después se pregunta cada una y se escribe cómo suena en
   rōmaji. Cada kana tiene su tarjeta FSRS, como las palabras.

   Se guarda en meta.kana = { cards: { あ: tarjeta }, stamps: { あ: ms }, today: { day, fresh, answered } }.
   Las tarjetas se sincronizan con la cuenta (tabla kana_cards, reading-sync.js,
   sección 13); lo de hoy se queda en el dispositivo. Sin pestaña propia: se abre desde Hoy, desde la
   bienvenida de «Empiezo de cero» y desde Repasar, y lleva «← Volver».
   Se carga después de proof.js (usa funciones de study.js).
   ========================================= */

let kanaRun = null; // { queue: [{ id, fresh }], total, done, right, missed: Set, taught }

const kanaCards = () => meta.kana.cards ??= {};
const kanaDueAt = (id) => kanaCards()[id] ? new Date(kanaCards()[id].due).getTime() : null;
const kanaToday = () => meta.kana.today?.day === today() ? meta.kana.today : { day: today(), fresh: 0, answered: 0 };
const kanaLesson = () => nextKanaLesson({ now: Date.now(), dueAt: kanaDueAt, newToday: kanaToday().fresh }, STUDY_CONFIG.kana);
const kanaStarted = () => Object.keys(kanaCards()).length > 0;

function speakKana(id) {
  speak(id);
}

/* La tabla entera, para consultarla: lo empezado, marcado */
function kanaChartHTML() {
  const rows = kanaRows();
  const block = (script, title) => `
    <h4>${t(title)}</h4>
    <div class="kana-chart">${rows.filter((row) => row.script === script).map((row) => `
      <div class="kana-chart-row">${row.chars.map((item) => `
        <span class="kana-cell${kanaCards()[item.id] ? " kana-known" : ""}"><b lang="ja">${item.id}</b><small>${item.romaji}</small></span>`).join("")}
      </div>`).join("")}
    </div>`;
  return `<details class="panel kana-table"><summary><h3>${t("Tabla de kana")}</h3></summary>
    ${block("hiragana", "Hiragana")}${block("katakana", "Katakana")}</details>`;
}

function renderKana() {
  if (kanaRun) return showKanaQuestion();
  const lesson = kanaLesson();
  const { hiragana, katakana } = lesson.byScript;
  const nothing = !lesson.due.length && !lesson.fresh.length;
  $("kanaArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML(nothing && lesson.started ? "celebrate" : "idle")}
      <h3>${t("Hiragana {h} / {ht} · Katakana {k} / {kt}", { h: hiragana.started, ht: hiragana.total, k: katakana.started, kt: katakana.total })}</h3>
      <p>${!lesson.started
        ? t("El japonés se escribe con dos silabarios, hiragana y katakana, y con kanjis. Empieza por el hiragana: una fila cada vez, y te preguntamos cómo suena cada letra.")
        : nothing ? (lesson.waitingNew ? t("Por hoy ya has empezado bastantes: mañana, una fila nueva. Las de hoy volverán para repasarlas.")
          : lesson.started === lesson.total ? t("¡Ya has visto todo el hiragana y el katakana! Aquí seguirán saliendo los repasos.") : t("No queda nada que repasar ahora."))
        : t("{due} y {fresh}.", { due: plural(lesson.due.length, "kana que repasar", "kanas que repasar"), fresh: plural(lesson.fresh.length, "nueva", "nuevas") })}</p>
      ${nothing ? "" : `<button id="kanaStartBtn" class="button button-primary" type="button">${t("Empezar")}</button>`}
    </div>
    ${kanaChartHTML()}`;
  if ($("kanaStartBtn")) {
    $("kanaStartBtn").onclick = startKana;
    $("kanaStartBtn").focus();
  }
}

function startKana() {
  const lesson = kanaLesson();
  const queue = [...shuffle(lesson.due).map((id) => ({ id, fresh: false })), ...shuffle(lesson.fresh).map((id) => ({ id, fresh: true }))];
  if (!queue.length) return renderKana();
  kanaRun = { queue, total: queue.length, done: 0, right: 0, missed: new Set(), fresh: lesson.fresh, taught: !lesson.fresh.length };
  // Primero lo que vence; la fila nueva se enseña justo antes de preguntarla
  renderKana();
}

/* La fila nueva: cada kana con su sonido, antes de preguntar nada */
function showKanaTeach() {
  const items = kanaItems();
  $("kanaArea").innerHTML = `
    <div class="card new-word-card">
      <div class="card-top"><span class="pill">${t("Fila nueva")}</span></div>
      <div class="kana-teach">${kanaRun.fresh.map((id) => `
        <button class="kana-cell kana-big" type="button" data-kana-say="${id}" title="${t("Escuchar")}">
          <b lang="ja">${id}</b><small>${items.get(id).romaji}</small></button>`).join("")}</div>
      <p class="helper">${t("Tócalas para oírlas. Fíjate en cómo suena cada una: ahora te las preguntamos.")}</p>
      <button id="kanaTaughtBtn" class="button button-primary" type="button">${t("Pregúntame")}</button>
    </div>`;
  $("kanaArea").querySelectorAll("[data-kana-say]").forEach((button) => { button.onclick = () => speakKana(button.dataset.kanaSay); });
  $("kanaTaughtBtn").onclick = () => { kanaRun.taught = true; showKanaQuestion(); };
  $("kanaTaughtBtn").focus();
}

function showKanaQuestion() {
  if (!kanaRun.queue.length) return endKana();
  const card = kanaRun.queue[0];
  if (card.fresh && !kanaRun.taught) return showKanaTeach();
  const item = kanaItems().get(card.id);
  $("kanaArea").innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${card.again ? t("Otra vez") : card.fresh ? t("Nuevo") : t("Repaso")}</span>
        <span class="card-progress">${kanaRun.done + 1} / ${kanaRun.total}</span>
      </div>
      <div class="meter" aria-hidden="true"><div style="width:${(kanaRun.done / kanaRun.total) * 100}%"></div></div>
      <div class="card-symbol" lang="ja">${card.id}</div>
      <form id="kanaForm" autocomplete="off">
        <input id="kanaInput" class="reading-input" type="text" inputmode="text" autocapitalize="off" autocomplete="off" spellcheck="false"
          placeholder="${t("¿Cómo suena? (en letras: ka, shi…)")}" aria-label="${t("¿Cómo suena? (en letras: ka, shi…)")}">
        <button id="kanaCheckBtn" class="button button-primary" type="submit">${t("Comprobar")}</button>
        <button id="kanaUnknownBtn" class="button button-secondary" type="button">${t("No lo sé")}</button>
      </form>
      <p id="kanaFeedback" class="message" role="status"></p>
      <div id="kanaAnswer"></div>
    </div>
    <p class="session-exit"><button id="kanaEndBtn" class="link-btn" type="button">${t("Terminar la sesión")}</button></p>`;
  $("kanaEndBtn").onclick = endKana;
  $("kanaInput").focus();

  let answered = false;
  const finish = async (correct) => {
    if (answered) return;
    answered = true;
    $("kanaInput").disabled = true;
    $("kanaArea").querySelector(".card").classList.add("answered");
    $("kanaCheckBtn").remove();
    $("kanaUnknownBtn").remove();
    showVerdict($("kanaFeedback"), correct ? "correct" : "incorrect", correct ? t("¡Correcto!") : t("Esta es la respuesta:"));
    $("kanaAnswer").innerHTML = `
      <p class="reading"><span lang="ja">${card.id}</span> <span class="romaji">${item.romaji}</span></p>
      ${"speechSynthesis" in window ? `<button id="kanaSpeakBtn" class="button button-quiet speak-btn" type="button">🔊 ${t("Escuchar")}</button>` : ""}
      <div class="card-actions"><button id="kanaNextBtn" class="button button-primary" type="button">${t("Siguiente")}</button></div>`;
    if ($("kanaSpeakBtn")) $("kanaSpeakBtn").onclick = () => speakKana(card.id);
    await gradeKana(card, correct);
    $("kanaNextBtn").onclick = () => {
      kanaRun.queue.shift();
      if (correct) { kanaRun.done++; if (!card.again) kanaRun.right++; }
      else kanaRun.queue.push({ ...card, again: true }); // vuelve al final hasta que salga
      showKanaQuestion();
    };
    $("kanaNextBtn").focus();
  };
  $("kanaForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("kanaInput").value.trim()) {
      $("kanaFeedback").textContent = t("Escribe cómo suena, en letras.");
      return;
    }
    finish(kanaAnswerOk(item, $("kanaInput").value));
  });
  $("kanaUnknownBtn").onclick = () => finish(false);
}

/* Mueve su tarjeta: solo el primer intento de la lección cuenta (las repetidas
   hasta acertarla son práctica). Acertar es «Bien»; fallar, «Otra vez». */
async function gradeKana(card, correct) {
  if (card.again) return;
  const now = new Date(), rating = correct ? "good" : "again";
  const before = kanaCards()[card.id] ? { ...kanaCards()[card.id] } : FSRS.createEmptyCard(now);
  const next = fsrsScheduler().next(before, now, RATING[rating]).card;
  kanaCards()[card.id] = storedCard(next);
  (meta.kana.stamps ??= {})[card.id] = now.getTime(); // para la sincronización: gana la más reciente
  logReview("kana", card.id, rating, before, next, now.getTime());
  const day = kanaToday();
  meta.kana.today = { day: day.day, fresh: day.fresh + (card.fresh ? 1 : 0), answered: day.answered + 1 };
  if (!correct) kanaRun.missed.add(card.id);
  await saveMeta();
  scheduleSync();
}

function endKana() {
  const { done, right, missed } = kanaRun;
  const items = kanaItems();
  kanaRun = null;
  const lesson = kanaLesson();
  $("kanaArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML(done ? "celebrate" : "idle")}
      <h3>${t("Lección terminada")}</h3>
      <p>${done ? t("Has repasado {n} · {percent} % a la primera.", { n: plural(done, "kana", "kanas"), percent: Math.round((right / done) * 100) })
        : t("No has respondido ninguna: puedes empezar cuando quieras.")}</p>
      ${missed.size ? `<ul class="missed-list">${[...missed].map((id) => `<li><strong lang="ja">${id}</strong> <span>${items.get(id).romaji}</span></li>`).join("")}</ul>` : ""}
      <div class="row-actions">
        ${lesson.due.length || lesson.fresh.length ? `<button id="kanaMoreBtn" class="button button-primary" type="button">${t("Otra lección")}</button>` : ""}
        <button class="button button-outline" data-go="today" type="button">${t("Volver a Hoy")}</button>
      </div>
    </div>
    ${kanaChartHTML()}`;
  if ($("kanaMoreBtn")) $("kanaMoreBtn").onclick = startKana;
}

/* Para Hoy (today.js): lo que hay de kana para hoy */
function kanaTodayState() {
  const lesson = kanaLesson();
  // Quien empezó de cero (sin nada dado por sabido) lo ve desde el principio; los demás, si lo empezaron
  const beginner = !!meta.reading.placedAt && !meta.reading.assumed;
  return { show: beginner || kanaStarted(), due: lesson.due.length, fresh: lesson.fresh.length, answered: kanaToday().answered,
    started: lesson.started, total: lesson.total };
}
