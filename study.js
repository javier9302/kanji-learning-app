/* =========================================
   KANJI LEARNING APP - study.js
   Estudio (tarjetas) y Escritura sobre el banco común (bank/bank.js).
   Se carga después de reading.js y antes de app.js.

   Palabras y kanjis son entidades distintas:
   - A una PALABRA se le pide su lectura, siempre completa (長い -> ながい) y
     con una sola respuesta. Si la escritura es ambigua se muestra con su
     significado: 角 (esquina) -> かど.
   - A un KANJI suelto nunca se le pide la lectura: solo su significado
     (aquí, con tarjetas que se voltean) o su escritura (en Escribir, con
     contexto: "Usado en: 勉＿").
   El modo "Escribir la lectura" es siempre un cuadro de texto, así que
   solo pregunta palabras; los kanjis salen únicamente en el modo tarjetas.

   Progreso del usuario:
     userWords  (reading.js)  por palabra, clave "escritura|lectura"
     userKanji  (aquí)        por kanji, clave el carácter
   Los dos llevan los mismos campos de repaso espaciado: studied, repetitions,
   interval, ease, nextReview, lastReviewed, correctCount, incorrectCount,
   streakDays y lastCorrectDay.
   ========================================= */

const MASTER_STREAK = 3;   // aciertos seguidos en días distintos para darla por dominada

let userKanji = new Map(); // carácter -> progreso
let session = null;        // sesión de estudio en curso
let draw = null;           // kanji que se está escribiendo

const hasKanjiChar = (text) => /\p{Script=Han}/u.test(text);
const kanjiOf = (text) => [...new Set([...text].filter((ch) => ch !== "々" && hasKanjiChar(ch)))];

/* =========================================
   1. ENTRADAS Y PROGRESO
   ========================================= */

/* Una palabra: del banco o, si no está, del diccionario propio del usuario
   (palabras de los textos o agregadas a mano) */
function wordEntry(id) {
  const word = BANK.words.get(id);
  if (word) return word;
  const own = words.get(id);
  if (!own) return null;
  return {
    id, w: own.lemma, r: own.reading, en: own.meanings || [], es: own.meaningsEs || [],
    alt: [], amb: false, level: null, kanji: kanjiOf(own.lemma), custom: true
  };
}

const meaningOf = (entry) => BANK.meaning(entry, lang);

function withSRS(record) {
  record.studied ??= false;
  record.repetitions ??= 0;
  record.interval ??= 0;
  record.ease ??= 2.5;
  record.nextReview ??= today();
  record.lastReviewed ??= null;
  record.correctCount ??= 0;
  record.incorrectCount ??= 0;
  record.streakDays ??= 0;
  record.lastCorrectDay ??= "";
  return record;
}

function blankUserKanji(c) {
  const now = Date.now();
  return withSRS({
    id: c, status: "unknown", knowsMeaning: false, canWrite: false, writes: 0,
    firstSeen: now, lastSeen: now, updatedAt: now
  });
}

async function saveUserKanji(record) {
  record.updatedAt = Date.now();
  userKanji.set(record.id, record);
  await putRecords("userKanji", [record]);
  scheduleSync();
}

async function loadStudyData() {
  userKanji = new Map((await getAll("userKanji")).map((k) => [k.id, k]));
}

const isDue = (record) => record.studied && record.nextReview <= today();

/* Calcula, sin modificar nada, cómo quedaría el repaso tras una respuesta */
function schedule(record, rating, card = {}) {
  const ease = record.ease || 2.5;
  const prev = record.interval || 0;
  const reps = record.repetitions || 0;

  if (rating === "again") {
    return { interval: 0, repetitions: 0, ease: Math.max(1.3, ease - 0.2) };
  }
  // Acertada tras fallarla en esta misma sesión: vuelve mañana.
  if (card.failed) return { interval: 1, repetitions: 1, ease };
  // Práctica extra (aún no tocaba): no cambia el calendario.
  if (card.group === "extra") return { interval: prev, repetitions: reps, ease, keepDate: true };

  if (rating === "hard") {
    return { interval: Math.max(1, Math.round(prev * 1.2)), repetitions: reps + 1, ease: Math.max(1.3, ease - 0.15) };
  }
  if (rating === "easy") {
    return {
      interval: reps === 0 ? 4 : Math.max(prev + 2, Math.round(prev * ease * 1.3)),
      repetitions: reps + 1, ease: ease + 0.15
    };
  }
  return {
    interval: reps === 0 ? 1 : Math.max(prev + 1, reps === 1 ? 3 : Math.round(prev * ease)),
    repetitions: reps + 1, ease
  };
}

/* Elementos ya estudiados, con la forma que usan las estadísticas */
function studyItems() {
  const list = [];
  for (const record of userWords.values()) {
    if (!record.studied) continue;
    list.push({
      ...record, type: "word", value: record.lemma, detail: record.reading,
      level: wordEntry(record.id)?.level || meta.reading.level || "N5",
      status: record.interval >= 21 ? "mature" : "learning"
    });
  }
  for (const record of userKanji.values()) {
    if (!record.studied) continue;
    const kanji = BANK.kanji.get(record.id);
    list.push({
      ...record, type: "kanji", value: record.id, detail: kanji ? meaningOf(kanji).slice(0, 2).join(", ") : "",
      level: kanji?.level || "N5",
      status: record.interval >= 21 ? "mature" : "learning"
    });
  }
  return list;
}

/* =========================================
   2. QUÉ TOCA ESTUDIAR
   ========================================= */

const levelFits = (entryLevel, level) => level === "ALL" || entryLevel === level || entryLevel === null;

/* Tarjetas posibles con los filtros elegidos, por grupos:
   due (toca repasar), fresh (nuevas, primero las que está aprendiendo al leer)
   y extra (ya estudiadas que aún no tocan) */
/* El contenido depende del modo. Escribir la lectura solo existe para
   palabras: en ese modo "Kanjis" y "Palabras y kanjis" ni se muestran.
   En el modo tarjetas están las tres opciones. */
function syncStudyControls() {
  const typing = $("studyMode").value === "type";
  for (const option of $("studyType").options) {
    option.hidden = option.disabled = typing && option.value !== "word";
  }
  if (typing && $("studyType").value !== "word") {
    $("studyType").value = prefs.studyType = "word";
    saveLocal("kanji-prefs", prefs);
  }
}

function studyCards() {
  const type = $("studyMode").value === "type" ? "word" : $("studyType").value;
  const level = $("studyLevel").value;
  const due = [], learning = [], fresh = [], extra = [];
  const card = (kind, entry, rec, group) => ({ kind, id: entry.id || entry.c, entry, rec, group });

  if (type !== "kanji") {
    const seen = new Set();
    for (const rec of userWords.values()) {
      const entry = wordEntry(rec.id);
      if (!entry || !hasKanjiChar(entry.w)) continue; // en kana no hay lectura que preguntar
      seen.add(rec.id);
      if (entry.kana && !rec.studied) continue;       // casi siempre va en kana (有る): no se estudia
      if (!levelFits(entry.level, level)) continue;
      if (rec.studied) (isDue(rec) ? due : extra).push(card("word", entry, rec, isDue(rec) ? "due" : "extra"));
      else if (rec.status === "learning") learning.push(card("word", entry, rec, "new"));
      else if (rec.status !== "mastered") fresh.push(card("word", entry, rec, "new"));
    }
    for (const entry of BANK.words.values()) {
      if (!seen.has(entry.id) && !entry.kana && levelFits(entry.level, level)) fresh.push(card("word", entry, null, "new"));
    }
  }

  if (type !== "word") {
    // Primero los kanjis de las palabras que ya conoce: son los útiles ahora
    const inKnownWords = new Set();
    for (const rec of userWords.values()) {
      if (rec.studied || rec.status === "mastered" || rec.status === "learning") {
        for (const c of wordEntry(rec.id)?.kanji || []) inKnownWords.add(c);
      }
    }
    const later = [];
    for (const kanji of BANK.kanji.values()) {
      if (!levelFits(kanji.level, level) || !meaningOf(kanji).length) continue;
      const rec = userKanji.get(kanji.c);
      if (rec?.studied) (isDue(rec) ? due : extra).push(card("kanji", kanji, rec, isDue(rec) ? "due" : "extra"));
      else (inKnownWords.has(kanji.c) ? learning : later).push(card("kanji", kanji, rec || null, "new"));
    }
    fresh.push(...later);
  }

  return {
    due, extra: extra.sort((a, b) => a.rec.nextReview.localeCompare(b.rec.nextReview)),
    fresh: [...shuffle(learning), ...shuffle(fresh)]
  };
}

/* El banco del nivel elegido se descarga la primera vez que hace falta */
async function ensureStudyBank() {
  const level = $("studyLevel").value;
  await (level === "ALL" ? BANK.loadUpTo(meta.reading.level || "N5") : BANK.load(level));
}

async function renderStudyHome() {
  syncStudyControls();
  if (session) return;
  const area = $("studyArea");
  try {
    await ensureStudyBank();
  } catch {
    area.innerHTML = `<div class="empty-state"><h3>${t("No se pudo cargar el contenido de este nivel")}</h3>
      <p>${t("Comprueba la conexión y vuelve a intentarlo.")}</p></div>`;
    return;
  }
  if (session || $("againBtn")) return; // mientras cargaba empezó o terminó una sesión

  const { due, fresh } = studyCards();
  area.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">学</div>
      <h3>${plural(due.length, "repaso pendiente", "repasos pendientes")} · ${plural(fresh.length, "nuevo", "nuevos")}</h3>
      <p>${due.length || fresh.length
        ? t("Pulsa “Iniciar repaso” para empezar. Primero salen los repasos pendientes y después elementos nuevos.")
        : t("No queda nada por estudiar con estos filtros. Cambia el contenido o el nivel.")}</p>
    </div>`;
}

async function startSession() {
  await ensureStudyBank().catch(() => {});
  const count = Number($("studyCount").value) || Infinity; // 0 = todas
  const { due, fresh, extra } = studyCards();
  const queue = [...shuffle(due), ...fresh, ...extra].slice(0, count);

  if (!queue.length) {
    session = null;
    document.body.classList.remove("studying");
    return renderStudyHome();
  }
  session = { queue, total: queue.length, done: 0, firstTry: 0, missed: new Map(), mode: $("studyMode").value };
  document.body.classList.add("studying");
  showCard();
  $("studyArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================================
   3. TARJETAS
   ========================================= */

const GROUP_LABEL = () => ({ due: t("Repaso"), new: t("Nuevo"), extra: t("Práctica extra") });

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

const gloss = (entry, max = 3) => meaningOf(entry).slice(0, max).join(", ");

/* Lo que se pregunta: la palabra (con su significado si es ambigua) o el kanji */
function questionHTML(card) {
  const { entry } = card;
  if (card.kind === "kanji") {
    return `<div class="card-symbol" lang="ja">${escapeHTML(entry.c)}</div>
      <p class="helper">${t("¿Qué significa este kanji?")}</p>`;
  }
  return `<div class="card-symbol ${[...entry.w].length > 1 ? "word" : ""}" lang="ja">${escapeHTML(entry.w)}</div>
    ${BANK.isAmbiguous(entry)
      ? `<p class="card-sense">（${escapeHTML(gloss(entry, 2))}）</p>` : ""}`;
}

/* Lo que se enseña al responder */
function answerHTML(card) {
  const { entry } = card;
  if (card.kind === "kanji") {
    const examples = [...entry.words].sort((a, b) => userWords.has(b.id) - userWords.has(a.id)).slice(0, 3);
    return `
      <p class="meaning">${escapeHTML(gloss(entry, 4))}</p>
      ${examples.length ? `<p class="related">${examples.map((word) =>
        `<span lang="ja">${escapeHTML(word.w)}（${escapeHTML(word.r)}）</span>`).join("")}</p>` : ""}`;
  }
  const parts = entry.kanji.map((c) => BANK.kanji.get(c)).filter((k) => k && meaningOf(k).length);
  return `
    <p class="reading" lang="ja">${escapeHTML(entry.r)}</p>
    <p class="meaning">${escapeHTML(gloss(entry))}</p>
    ${parts.length && !(parts.length === 1 && entry.w === parts[0].c) ? `<p class="kanji-note">${parts.map((k) =>
      `${escapeHTML(k.c)} ${escapeHTML(gloss(k, 2))}`).join(" · ")}</p>` : ""}
    ${"speechSynthesis" in window
      ? `<button id="speakBtn" class="button button-quiet speak-btn" type="button">🔊 ${t("Escuchar")}</button>` : ""}`;
}

function endSession() {
  const { total, firstTry, missed } = session;
  session = null;
  document.body.classList.remove("studying");

  const missedList = [...missed.values()].map((card) => `
    <li><strong lang="ja">${escapeHTML(card.entry.w || card.entry.c)}</strong>
      <span>${escapeHTML(card.kind === "word" ? card.entry.r : gloss(card.entry, 2))}</span></li>`).join("");

  $("studyArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>${t("Sesión terminada")}</h3>
      <p>${total
        ? t("Has repasado {n} · {percent} % a la primera.", {
            n: plural(total, "elemento", "elementos"), percent: Math.round((firstTry / total) * 100) })
        : t("No quedaban tarjetas por repasar.")}</p>
      ${missedList ? `<ul class="missed-list">${missedList}</ul>` : ""}
      <div class="row-actions">
        <button id="againBtn" class="button button-primary" type="button">${t("Otra sesión")}</button>
        <button class="button button-outline" data-go="progress" type="button">${t("Ver progreso")}</button>
      </div>
    </div>`;
  $("againBtn").onclick = startSession;
  $("againBtn").focus();
  renderAll();
  syncNow();
}

function showCard() {
  if (!session.queue.length) return endSession();

  const card = session.queue[0];
  const { entry } = card;
  const area = $("studyArea");
  // La lectura se escribe solo en palabras; un kanji siempre es tarjeta que se voltea
  const form = session.mode === "type" && card.kind === "word" ? "type" : "flash";

  area.innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${card.failed ? t("Otra vez") : GROUP_LABEL()[card.group]}</span>
        <span class="card-progress">${session.done + 1} / ${session.total}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <div style="width:${(session.done / session.total) * 100}%"></div>
      </div>
      ${questionHTML(card)}
      ${form === "type" ? `
      <form id="readingForm" autocomplete="off">
        <input id="readingInput" class="reading-input" type="text" lang="ja" inputmode="text"
          placeholder="${t("Escribe la lectura (hiragana)")}"
          autocapitalize="off" autocomplete="off" spellcheck="false">
        <button id="checkBtn" class="button button-primary" type="submit">${t("Comprobar")}</button>
        <button id="unknownBtn" class="button button-secondary" type="button">${t("No lo sé")}</button>
      </form>` : `
      <div id="readingForm">
        <button id="revealBtn" class="button button-primary" type="button">${t("Mostrar respuesta")}</button>
      </div>`}
      <p id="feedback" class="message"></p>
      <div id="answer"></div>
    </div>`;

  const feedback = $("feedback");
  const answer = $("answer");

  /* Muestra la respuesta y los botones para continuar: [valoración, etiqueta, clase] */
  function reveal(ratings, preferred) {
    const days = (rating) => rating === "next" ? null : schedule(card.rec || {}, rating, card).interval;
    answer.innerHTML = `
      ${answerHTML(card)}
      <div class="card-actions">
        ${ratings.map(([rating, label, cls], i) => `
          <button class="button ${cls}" type="button" data-rate="${rating}">
            ${label}
            <small>${i + 1}${days(rating) === null || card.group === "extra" && rating !== "again"
              ? "" : ` · ${days(rating) ? `${days(rating)} d` : t("hoy")}`}</small>
          </button>`).join("")}
      </div>`;
    if ($("speakBtn")) $("speakBtn").onclick = () => speak(entry.w);
    answer.querySelectorAll("[data-rate]").forEach((button) => {
      button.onclick = async () => {
        answer.querySelectorAll("[data-rate]").forEach((b) => { b.disabled = true; });
        if (button.dataset.rate !== "next") await gradeCard(card, button.dataset.rate);
        advance(card);
      };
    });
    answer.querySelector(`[data-rate="${preferred}"]`).focus(); // Enter otra vez = siguiente
  }

  const NEXT = [["next", t("Siguiente"), "button-primary"]];
  const PASSED = [["hard", t("Difícil"), "button-hard"], ["good", t("Bien"), "button-good"], ["easy", t("Fácil"), "button-easy"]];

  /* Tras responder: acertada -> valorar; fallada -> se registra ya y solo queda seguir */
  async function finish(correct, message) {
    feedback.textContent = message;
    feedback.className = `message ${correct ? "correct" : "incorrect"}`;
    if (correct) return reveal(PASSED, "good");
    await gradeCard(card, "again");
    reveal(NEXT, "next");
  }

  if (form === "flash") {
    $("revealBtn").onclick = () => {
      $("revealBtn").remove();
      reveal([["again", t("Otra vez"), "button-wrong"], ...PASSED], "good");
    };
    $("revealBtn").focus();
    return;
  }

  const input = $("readingInput");
  let answered = false;
  // Si WanaKana está cargado, "ka" se convierte en "か" al escribir
  if (window.wanakana && typeof window.wanakana.bind === "function") window.wanakana.bind(input);
  input.focus();

  const lock = () => {
    answered = true;
    input.disabled = $("checkBtn").disabled = $("unknownBtn").disabled = true;
  };
  $("unknownBtn").onclick = () => {
    if (answered) return;
    lock();
    finish(false, t("Esta es la respuesta:"));
  };
  $("readingForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (answered) return;
    const typed = normalizeReading(input.value);
    if (!typed) {
      feedback.textContent = t("Escribe una lectura primero.");
      return;
    }
    const correct = typed === normalizeReading(entry.r);
    // Otra lectura válida de la MISMA palabra (にほん / にっぽん) no es un fallo
    if (!correct && entry.alt.some((alt) => normalizeReading(alt) === typed)) {
      feedback.textContent = t("Esa lectura también existe, pero aquí se pide la más habitual.");
      feedback.className = "message";
      input.select();
      return;
    }
    // La lectura de otro significado de la misma escritura sí es un fallo
    const other = !correct && (BANK.byWriting.get(entry.w) || [])
      .find((word) => word !== entry && normalizeReading(word.r) === typed);
    lock();
    finish(correct, correct ? t("¡Correcto!")
      : other ? t("Esa es la lectura de otro significado ({meaning}).", { meaning: gloss(other, 2) })
      : t("No es correcto."));
  });
}

/* Pasa a la siguiente tarjeta; las falladas vuelven a salir un poco después */
function advance(card) {
  const index = session.queue.indexOf(card);
  if (index >= 0) session.queue.splice(index, 1);

  if (card.pendingRetry) {
    card.pendingRetry = false;
    session.queue.splice(Math.min(3, session.queue.length), 0, card);
  } else {
    session.done++;
    if (!card.failed) session.firstTry++;
  }
  showCard();
}

/* Atajos: 1-4 eligen la valoración cuando la respuesta está a la vista */
function bindShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (!session || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.matches?.("input:not(:disabled), textarea, select")) return;
    const buttons = $("answer")?.querySelectorAll("[data-rate]:not(:disabled)");
    const button = buttons?.[Number(event.key) - 1];
    if (button) {
      event.preventDefault();
      button.click();
    }
  });
}

/* Registra la respuesta: repaso espaciado, historial del día y estado del elemento */
async function gradeCard(card, rating) {
  const correct = rating !== "again";
  const rec = card.rec ??= card.kind === "word"
    ? userWords.get(card.id) || blankUserWord(card.entry.w, card.entry.r)
    : userKanji.get(card.id) || blankUserKanji(card.id);
  withSRS(rec);
  const next = schedule(rec, rating, card);

  // Historial diario: solo cuenta el primer intento de cada tarjeta
  if (!card.failed) {
    const day = meta.days[today()] ??= { r: 0, c: 0, n: 0 };
    day.r++;
    if (correct) day.c++;
    if (!rec.studied) day.n++;
  }

  if (correct) {
    rec.correctCount++;
    if (rec.lastCorrectDay !== today()) { rec.streakDays++; rec.lastCorrectDay = today(); }
  } else {
    rec.incorrectCount++;
    rec.streakDays = 0;
    card.failed = true;
    card.pendingRetry = true;
    session?.missed.set(card.id, card);
  }

  rec.repetitions = next.repetitions;
  rec.interval = next.interval;
  rec.ease = next.ease;
  if (!next.keepDate) rec.nextReview = daysFromNow(next.interval);
  rec.studied = true;
  rec.lastReviewed = new Date().toISOString();
  rec.lastSeen = Date.now();

  // Aprendida: tres aciertos seguidos en días distintos. Un fallo la devuelve a "learning".
  if (card.kind === "word") rec.canReadKanji = correct; else rec.knowsMeaning = correct;
  if (!correct) rec.status = "learning";
  else if (rec.streakDays >= MASTER_STREAK) rec.status = "mastered";
  else if (rec.status === "unknown") rec.status = "learning";

  if (card.kind === "word") await saveUserWord(rec); else await saveUserKanji(rec);
  await saveMeta();
  updateCounts();
}

/* =========================================
   4. ESCRITURA
   -----------------------------------------
   Se pide UN kanji cada vez, por su significado y con una palabra de
   ejemplo en la que el kanji pedido va oculto:  Usado en: 勉＿（べんきょう）
   ========================================= */

/* Kanjis que el estudiante ya ha visto: los de las palabras que conoce o
   repasa, y los que ha acertado por su significado */
function drawCandidates() {
  const level = $("drawLevel").value;
  const chars = new Set();
  for (const rec of userWords.values()) {
    if (rec.status === "mastered" || rec.canReadKanji || rec.studied && rec.correctCount > 0) {
      for (const c of wordEntry(rec.id)?.kanji || []) chars.add(c);
    }
  }
  for (const rec of userKanji.values()) if (rec.knowsMeaning) chars.add(rec.id);
  return [...chars].map((c) => BANK.kanji.get(c))
    .filter((kanji) => kanji && meaningOf(kanji).length && (level === "ALL" || kanji.level === level));
}

/* Palabra de ejemplo: mejor una que el estudiante conozca; si no, la más fácil */
function exampleWord(kanji) {
  const rank = (word) => {
    const rec = userWords.get(word.id);
    return (rec && (rec.studied || rec.status === "mastered" || rec.status === "learning") ? 0 : 10) +
      BANK.LEVELS.indexOf(word.level) + [...word.w].length / 10;
  };
  return [...kanji.words].sort((a, b) => rank(a) - rank(b))[0] || null;
}

async function renderDraw() {
  await BANK.loadUpTo(meta.reading.level || "N5").catch(() => {});
  if (document.body.dataset.view !== "draw") return;
  const candidates = drawCandidates();
  $("drawCount").textContent = plural(candidates.length, "kanji disponible", "kanjis disponibles");

  if (!candidates.length) {
    draw = null;
    $("drawArea").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" lang="ja">書</div>
        <h3>${t("Aún no hay kanjis para escribir")}${$("drawLevel").value === "ALL" ? "" : ` (${$("drawLevel").value})`}</h3>
        <p>${t("Aquí aparecen los kanjis de las palabras que ya has acertado al estudiar o que dominas al leer.")}</p>
      </div>`;
    return;
  }
  // Se conserva el kanji a medias si sigue siendo válido
  if (!draw || !candidates.includes(draw.kanji)) nextDraw();
}

async function nextDraw() {
  const candidates = drawCandidates();
  if (!candidates.length) return renderDraw();

  let queue = (draw?.queue || []).filter((k) => candidates.includes(k));
  if (!queue.length) {
    queue = shuffle(candidates);
    if (queue.length > 1 && queue[0] === draw?.kanji) queue.push(queue.shift());
  }
  const kanji = queue.shift();
  const current = draw = { kanji, queue };
  const area = $("drawArea");
  area.innerHTML = `<p class="message">${t("Cargando…")}</p>`;

  let strokes;
  try {
    strokes = await fetchStrokes(kanji.c);
  } catch (error) {
    if (draw !== current) return;
    area.innerHTML = `
      <div class="card">
        <p class="message incorrect">${t("No se pudieron cargar los trazos ({error}).", { error: escapeHTML(error.message) })}</p>
        <div class="row-actions">
          <button id="drawNextBtn" class="button button-outline" type="button">${t("Otro kanji")}</button>
        </div>
      </div>`;
    $("drawNextBtn").onclick = nextDraw;
    return;
  }
  if (draw !== current) return;

  // El contexto nunca enseña el kanji pedido: en el ejemplo va como ＿
  const word = exampleWord(kanji);
  const masked = word ? [...word.w].map((ch) => ch === kanji.c ? "＿" : ch).join("") : "";
  const half = KVG_SIZE / 2;
  area.innerHTML = `
    <div class="card draw-card">
      <div class="card-top">
        <span class="pill">${escapeHTML(kanji.level)}</span>
        <span id="drawProgress" class="card-progress"></span>
      </div>
      <p class="helper">${t("Escribe el kanji que significa:")}</p>
      <p class="meaning draw-meaning">${escapeHTML(gloss(kanji, 4))}</p>
      ${word ? `<p class="draw-context">${t("Usado en:")} <strong lang="ja">${escapeHTML(masked)}</strong>
        <span lang="ja">（${escapeHTML(word.r)}）</span> · ${escapeHTML(gloss(word, 2))}</p>` : ""}
      <svg id="drawPad" class="draw-pad" viewBox="0 0 ${KVG_SIZE} ${KVG_SIZE}" role="img" aria-label="${t("Zona de dibujo")}">
        <line class="guide" x1="${half}" y1="0" x2="${half}" y2="${KVG_SIZE}"/>
        <line class="guide" x1="0" y1="${half}" x2="${KVG_SIZE}" y2="${half}"/>
        ${strokes.map((d) => `<path class="stroke" d="${escapeHTML(d)}"/>`).join("")}
        <polyline id="drawInk" class="ink" points=""/>
      </svg>
      <p id="drawFeedback" class="message"></p>
      <div class="row-actions">
        <button id="drawHintBtn" class="button button-outline" type="button">${t("Pista")}</button>
        <button id="drawShowBtn" class="button button-outline" type="button">${t("Mostrar")}</button>
        <button id="drawClearBtn" class="button button-quiet" type="button">${t("Reiniciar")}</button>
        <button id="drawNextBtn" class="button button-primary" type="button">${t("Siguiente")} →</button>
      </div>
    </div>`;

  const pad = $("drawPad");
  const ink = $("drawInk");
  const feedback = $("drawFeedback");
  const paths = [...pad.querySelectorAll(".stroke")];
  let index = 0, misses = 0, mistakes = 0, points = null, shown = false;

  const say = (text, cls = "") => {
    feedback.textContent = text;
    feedback.className = `message ${cls}`;
  };
  const progress = () => {
    $("drawProgress").textContent = index < paths.length
      ? t("Trazo {i} / {n}", { i: index + 1, n: paths.length }) : plural(paths.length, "trazo", "trazos");
    $("drawHintBtn").disabled = $("drawShowBtn").disabled = index >= paths.length;
  };
  const reset = () => {
    paths.forEach((path) => { path.className.baseVal = "stroke"; });
    index = misses = mistakes = 0;
    shown = false;
    say("");
    progress();
  };

  /* Escrito entero sin pedir que se lo muestren: ya sabe escribirlo */
  async function completed() {
    say(mistakes ? t("Completado con {n}.", { n: plural(mistakes, "fallo", "fallos") }) : t("¡Perfecto!"),
      mistakes ? "" : "correct");
    $("drawNextBtn").focus();
    const rec = userKanji.get(kanji.c) || blankUserKanji(kanji.c);
    rec.canWrite = true;
    rec.writes = (rec.writes || 0) + 1;
    rec.lastSeen = Date.now();
    await saveUserKanji(rec);
  }

  function check(drawn) {
    const result = matchStroke(drawn, paths[index]);
    if (result !== "ok") {
      misses++;
      mistakes++;
      say(result === "reversed"
        ? t("El trazo va en la dirección contraria.") : t("Ese no es el trazo que toca."), "incorrect");
      if (misses >= 3) paths[index].classList.add("hint");
      return;
    }
    paths[index].className.baseVal = "stroke done";
    index++;
    misses = 0;
    progress();
    if (index < paths.length) return say("");
    if (!shown) completed();
  }

  const position = (event) => {
    const rect = pad.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * KVG_SIZE,
      ((event.clientY - rect.top) / rect.height) * KVG_SIZE
    ];
  };
  const trace = () => ink.setAttribute("points",
    points ? points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") : "");

  pad.onpointerdown = (event) => {
    if (index >= paths.length) return;
    event.preventDefault();
    try { pad.setPointerCapture(event.pointerId); } catch { /* puntero ya liberado */ }
    points = [position(event)];
    trace();
  };
  pad.onpointermove = (event) => {
    if (!points) return;
    points.push(position(event));
    trace();
  };
  pad.onpointerup = pad.onpointercancel = () => {
    if (!points) return;
    const drawn = points;
    points = null;
    trace();
    check(drawn);
  };

  $("drawHintBtn").onclick = () => paths[index]?.classList.add("hint");
  $("drawShowBtn").onclick = () => {
    paths.slice(index).forEach((path) => { path.className.baseVal = "stroke done shown"; });
    index = paths.length;
    shown = true;
    progress();
    say(t("Así se escribe. Pulsa “Reiniciar” para intentarlo."));
  };
  $("drawClearBtn").onclick = reset;
  $("drawNextBtn").onclick = nextDraw;
  reset();
}

/* =========================================
   5. MIGRACIÓN DEL MODELO ANTERIOR
   -----------------------------------------
   Antes kanjis y palabras eran el mismo tipo de registro (almacén "items")
   y un kanji se repasaba con una "palabra ancla". Su progreso pasa a la
   palabra correspondiente del banco. El almacén antiguo no se borra.
   ========================================= */

const loadScript = (src) => new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = src;
  script.onload = resolve;
  script.onerror = () => reject(new Error(src));
  document.head.appendChild(script);
});

async function migrateOldItems() {
  if (prefs.bankMigrated) return 0;
  const old = (await getAll("items")).filter((item) => item.studied || item.correctCount > 0);
  let moved = 0;

  if (old.length) {
    await BANK.loadUpTo("N1");
    if (old.some((item) => item.type === "kanji") && typeof KANJI_DATA === "undefined") {
      await loadScript("kanji-data.js").catch(() => {});
    }
    const anchors = typeof KANJI_DATA === "undefined" ? {} : KANJI_DATA;
    const changed = [], ownWords = [];

    for (const item of old) {
      // La palabra a la que corresponde el registro antiguo
      let writing = item.value, reading = item.dictionary?.readings?.[0];
      if (item.type === "kanji") {
        const anchor = item.dictionary?.source === "user" ? null : anchors[item.value];
        if (anchor) { writing = anchor.w; reading = anchor.r; }
      }
      let entry = reading ? BANK.words.get(BANK.id(writing, reading)) : null;
      entry ||= BANK.byWriting.get(writing)?.[0];
      if (!entry && !reading) continue;

      const id = entry ? entry.id : wordKey(writing, reading);
      if (!entry && !words.has(id)) {
        // No está en el banco: se conserva como palabra propia del usuario
        const own = { id, lemma: writing, reading, meanings: item.dictionary?.meanings || [],
          meaningsEs: [], pos: "", source: "user", updatedAt: Date.now() };
        words.set(id, own);
        ownWords.push(own);
      }

      const rec = withSRS(userWords.get(id) || blankUserWord(entry ? entry.w : writing, entry ? entry.r : reading));
      if (rec.studied && rec.repetitions >= (item.repetitions || 0)) continue; // ya tiene progreso mejor
      Object.assign(rec, {
        studied: !!item.studied,
        repetitions: item.repetitions || 0, interval: item.interval || 0, ease: item.ease || 2.5,
        nextReview: /^\d{4}-\d{2}-\d{2}$/.test(item.nextReview) ? item.nextReview : today(),
        lastReviewed: item.lastReviewed || null,
        correctCount: item.correctCount || 0, incorrectCount: item.incorrectCount || 0,
        canReadKanji: item.correctCount > 0,
        updatedAt: Date.now()
      });
      if (rec.status !== "mastered") rec.status = item.interval >= 21 ? "mastered" : "learning";
      userWords.set(id, rec);
      changed.push(rec);
      moved++;
    }
    await putRecords("userWords", changed);
    await putRecords("words", ownWords);
  }

  prefs.bankMigrated = Date.now();
  saveLocal("kanji-prefs", prefs);
  if (moved) scheduleSync();
  return moved;
}
