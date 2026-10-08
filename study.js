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
   Los dos llevan los mismos campos de repaso espaciado: studied, fsrs (la
   tarjeta de FSRS), nextReview, interval y repetitions (copias de la tarjeta
   que usan las estadísticas), lastReviewed, correctCount, incorrectCount,
   streakDays y lastCorrectDay.

   Los números que se pueden ajustar están en study-config.js.
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

/* ---------- Repaso espaciado: FSRS (vendor/ts-fsrs) ----------
   Cada registro guarda su tarjeta en record.fsrs. Una palabra nueva pasa por
   unos pasos cortos (minutos) dentro de la misma sesión y después FSRS decide
   cuántos días tarda en volver según lo bien que se recuerda. */

const RATING = { again: 1, hard: 2, good: 3, easy: 4 };
const DAY_MS = 86400000;
let scheduler = null;
const fsrsScheduler = () => scheduler ??= FSRS.fsrs(FSRS.generatorParameters(STUDY_CONFIG.fsrs));

/* Tarjeta FSRS de un registro. Lo repasado antes de FSRS se convierte: el
   intervalo que tenía pasa a ser su estabilidad y la facilidad, su dificultad. */
function fsrsCard(record, now = new Date()) {
  if (record.fsrs) return { ...record.fsrs };
  const card = FSRS.createEmptyCard(now);
  if (!record.studied || !record.interval) return card;
  const due = new Date(`${record.nextReview || today()}T00:00:00`);
  return {
    ...card, state: FSRS.State.Review, due,
    stability: record.interval, scheduled_days: record.interval,
    difficulty: Math.min(10, Math.max(1, 5 - ((record.ease || 2.5) - 2.5) * 5)),
    reps: record.repetitions || 1,
    last_review: record.lastReviewed ? new Date(record.lastReviewed) : new Date(due - record.interval * DAY_MS)
  };
}

/* Cómo quedaría la tarjeta tras una respuesta, sin modificar nada */
const nextCard = (record, rating, now = new Date()) =>
  fsrsScheduler().next(fsrsCard(record, now), now, RATING[rating]).card;

/* Guarda la tarjeta en el registro, con las fechas como texto para IndexedDB y Supabase */
function applyCard(record, card) {
  record.fsrs = {
    ...card, due: new Date(card.due).toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null
  };
  record.nextReview = isoDate(new Date(card.due));
  record.interval = card.scheduled_days;
  record.repetitions = card.reps;
  record.studied = true;
}

/* Una tarjeta que ya se domina: entra directamente con un intervalo largo */
function masteredCard(days, now = new Date()) {
  return {
    ...FSRS.createEmptyCard(now), state: FSRS.State.Review, reps: 1,
    stability: days, difficulty: 4, scheduled_days: days,
    due: new Date(now.getTime() + days * DAY_MS), last_review: now
  };
}

/* Sigue en los pasos cortos: vuelve a salir en esta misma sesión */
const staysInSession = (card) => card.scheduled_days === 0;

/* "10 min", "3 d", "2 meses": cuánto falta para que vuelva a salir */
function intervalLabel(card, now = new Date()) {
  const minutes = Math.max(1, Math.round((new Date(card.due) - now) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  const days = card.scheduled_days || Math.round(minutes / 1440);
  if (days < 60) return `${days} d`;
  if (days < 365) return plural(Math.round(days / 30), "mes", "meses");
  return plural(Math.round(days / 36.5) / 10, "año", "años");
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

const userLevel = () => meta.reading.level || "N5";
const withinLevel = (level) => !level || BANK.LEVELS.indexOf(level) <= BANK.LEVELS.indexOf(userLevel());
const maxNewCards = () => Math.max(0, Number(prefs.maxNew ?? STUDY_CONFIG.maxNewPerSession) || 0);

/* De dónde salió una palabra: manual (la agregó el usuario), lectura o frecuencia (el banco) */
const originOf = (rec) => rec?.origin || (rec && (rec.seen || rec.lookups) ? "lectura" : "frecuencia");

/* Kanjis CONOCIDOS: los que el usuario marcó o acertó y los de las palabras
   que domina (también las del nivel que se le dio por sabido). */
function knownKanji() {
  const known = new Set();
  for (const level of assumedLevels()) {
    for (const word of levelVocabulary(level)) {
      if (!word.kana) for (const c of word.kanji) known.add(c);
    }
  }
  for (const rec of userWords.values()) {
    if (rec.status === "mastered" || rec.studied && rec.canReadKanji) {
      for (const c of wordEntry(rec.id)?.kanji || []) known.add(c);
    }
  }
  for (const rec of userKanji.values()) {
    if (rec.knowsMeaning || rec.canWrite || rec.status === "mastered") known.add(rec.id);
  }
  return known;
}

/* Kanjis VISTOS: los que salieron en una lectura que el usuario terminó */
function seenKanji() {
  const seen = new Set();
  for (const rec of userKanji.values()) if (rec.seenAt) seen.add(rec.id);
  for (const text of texts) {
    if (!text.readAt) continue;
    for (const key of Object.keys(text.lemmas || {})) {
      for (const c of kanjiOf(key.split("|")[0])) seen.add(c);
    }
  }
  return seen;
}

/* Puntuación de una palabra nueva (pesos en study-config.js) y su porqué.
   blocked: kanjis avanzados que aún no han salido en una lectura. */
function scoreWord(entry, rec, known, seen) {
  const W = STUDY_CONFIG.weights;
  const manual = rec?.origin === "manual";
  const reading = !!rec && (rec.seen > 0 || rec.lookups > 0 || rec.origin === "lectura");
  const kanjiKnown = entry.kanji.filter((c) => known.has(c)).length;
  const coverage = entry.kanji.length ? kanjiKnown / entry.kanji.length : 0;
  const rank = BANK.frequency[entry.id] || 0;
  const frequency = rank ? Math.max(0, 1 - (rank - 1) / STUDY_CONFIG.frequencyMaxRank) : 0;

  const exempt = manual || !!rec?.knowsMeaning; // "Conozco la palabra pero no el kanji"
  const blocked = !exempt && STUDY_CONFIG.basicWordLevels.includes(entry.level)
    ? entry.kanji.filter((c) => STUDY_CONFIG.advancedKanjiLevels.includes(BANK.kanjiLevel(c)) && !seen.has(c))
    : [];

  return {
    score: manual * W.manual + reading * W.reading + coverage * W.kanji + frequency * W.frequency,
    manual, reading, kanjiKnown, kanjiTotal: entry.kanji.length, rank, blocked
  };
}

/* Palabras nuevas posibles, de mayor a menor puntuación. Salen del banco
   (hasta el nivel del usuario) y de las que el usuario agregó a mano o marcó
   al leer. excluded: las que esperan a que su kanji avanzado salga en una lectura. */
function newWordCandidates() {
  const known = knownKanji(), seen = seenKanji();
  const list = [], excluded = [];
  const consider = (entry, rec) => {
    const info = scoreWord(entry, rec, known, seen);
    (info.blocked.length ? excluded : list).push({ kind: "word", id: entry.id, entry, rec, group: "new", info });
  };

  const mine = new Set();
  for (const rec of userWords.values()) {
    const entry = wordEntry(rec.id);
    if (!entry) continue;
    mine.add(rec.id);
    if (rec.studied || rec.status === "mastered") continue;
    if (!hasKanjiChar(entry.w) || entry.kana) continue; // en kana no hay lectura que preguntar
    const manual = rec.origin === "manual";
    // Por encima de su nivel, o fuera del banco, solo lo que el usuario pidió
    if (entry.custom ? !manual && rec.status !== "learning" : !manual && !withinLevel(entry.level)) continue;
    consider(entry, rec);
  }
  for (const entry of BANK.words.values()) {
    if (!mine.has(entry.id) && !entry.kana && withinLevel(entry.level)) consider(entry, null);
  }

  const order = (a, b) => b.info.score - a.info.score ||
    BANK.LEVELS.indexOf(a.entry.level) - BANK.LEVELS.indexOf(b.entry.level);
  return { list: list.sort(order), excluded: excluded.sort(order) };
}

/* Tarjetas posibles, por grupos: due (toca repasar), fresh (nuevas, ya en el
   orden en que se presentan) y extra (ya estudiadas que aún no tocan). */
function studyCards() {
  const type = $("studyMode").value === "type" ? "word" : $("studyType").value;
  const due = [], extra = [], fresh = [];
  let excluded = [];
  const card = (kind, entry, rec, group) => ({ kind, id: entry.id || entry.c, entry, rec, group });

  if (type !== "kanji") {
    for (const rec of userWords.values()) {
      const entry = rec.studied && wordEntry(rec.id);
      if (!entry || !hasKanjiChar(entry.w)) continue;
      (isDue(rec) ? due : extra).push(card("word", entry, rec, isDue(rec) ? "due" : "extra"));
    }
    const candidates = newWordCandidates();
    fresh.push(...candidates.list);
    excluded = candidates.excluded;
  }

  if (type !== "word") {
    // Primero los kanjis de las palabras que ya conoce: son los útiles ahora
    const inKnownWords = new Set();
    for (const rec of userWords.values()) {
      if (rec.studied || rec.status === "mastered" || rec.status === "learning") {
        for (const c of wordEntry(rec.id)?.kanji || []) inKnownWords.add(c);
      }
    }
    const first = [], later = [];
    for (const kanji of BANK.kanji.values()) {
      if (!withinLevel(kanji.level) || !meaningOf(kanji).length) continue;
      const rec = userKanji.get(kanji.c);
      if (rec?.studied) (isDue(rec) ? due : extra).push(card("kanji", kanji, rec, isDue(rec) ? "due" : "extra"));
      else if (rec?.status !== "mastered") (inKnownWords.has(kanji.c) ? first : later).push(card("kanji", kanji, rec || null, "new"));
    }
    // En "Palabras y kanjis" se alternan: una palabra, un kanji
    const kanjiFresh = [...first, ...later];
    const words = fresh.splice(0);
    for (let i = 0; i < Math.max(words.length, kanjiFresh.length); i++) {
      if (words[i]) fresh.push(words[i]);
      if (kanjiFresh[i]) fresh.push(kanjiFresh[i]);
    }
  }

  return { due, fresh, excluded, extra: extra.sort((a, b) => a.rec.nextReview.localeCompare(b.rec.nextReview)) };
}

/* El banco se descarga hasta el nivel del usuario: por encima no se presentan palabras */
const ensureStudyBank = () => BANK.loadUpTo(userLevel());

/* Vista de depuración (Ajustes): por qué sale cada palabra nueva */
function debugHTML(fresh, excluded) {
  const row = ({ entry, info }) => `
    <tr>
      <td lang="ja">${escapeHTML(entry.w)}</td>
      <td>${info.score.toFixed(2)}</td>
      <td>${[
        info.manual ? t("agregada a mano") : "",
        info.reading ? t("vista en lecturas") : "",
        t("kanjis conocidos {known}/{total}", { known: info.kanjiKnown, total: info.kanjiTotal }),
        info.rank ? t("frecuencia n.º {rank}", { rank: info.rank }) : t("sin puesto de frecuencia"),
        info.blocked.length ? t("espera al kanji {kanji}", { kanji: info.blocked.join("、") }) : ""
      ].filter(Boolean).map(escapeHTML).join(" · ")}</td>
    </tr>`;
  const words = fresh.filter((card) => card.kind === "word");
  return `
    <details class="debug-panel" open>
      <summary>${t("Depuración: próximas palabras nuevas")}</summary>
      <p class="helper">${t("Puntuación = a mano × {manual} + lectura × {reading} + kanjis conocidos × {kanji} + frecuencia × {frequency}. Los pesos están en study-config.js.", STUDY_CONFIG.weights)}</p>
      <div class="table-scroll"><table class="debug-table">
        <thead><tr><th>${t("Palabra")}</th><th>${t("Puntos")}</th><th>${t("Por qué")}</th></tr></thead>
        <tbody>${words.slice(0, 20).map(row).join("")}</tbody>
      </table></div>
      ${excluded.length ? `
      <p class="helper">${t("{n} en espera: son básicas pero llevan un kanji avanzado que aún no ha salido en tus lecturas.", { n: plural(excluded.length, "palabra", "palabras") })}</p>
      <div class="table-scroll"><table class="debug-table">
        <tbody>${excluded.slice(0, 10).map(row).join("")}</tbody>
      </table></div>` : ""}
    </details>`;
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

  const { due, fresh, excluded } = studyCards();
  const news = Math.min(fresh.length, maxNewCards());
  area.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">学</div>
      <h3>${plural(due.length, "repaso pendiente", "repasos pendientes")} · ${plural(news, "nuevo", "nuevos")}</h3>
      <p>${due.length || news
        ? t("Pulsa “Iniciar repaso” para empezar. Primero salen los repasos pendientes y después, como mucho, {n} de tu nivel ({level}).", {
            n: plural(maxNewCards(), "elemento nuevo", "elementos nuevos"), level: userLevel() })
        : t("No queda nada por estudiar ahora. Lee un texto o agrega palabras en “Mis palabras”.")}</p>
    </div>
    ${prefs.debugStudy ? debugHTML(fresh, excluded) : ""}`;
}

async function startSession() {
  await ensureStudyBank().catch(() => {});
  const count = Number($("studyCount").value) || Infinity; // 0 = todas
  const { due, fresh, extra } = studyCards();
  // Primero lo pendiente; después las nuevas, con su tope; el resto, práctica extra
  const reviews = shuffle(due).slice(0, count);
  const news = fresh.slice(0, Math.min(maxNewCards(), count - reviews.length));
  const queue = [...reviews, ...news, ...extra].slice(0, count);

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
        <span class="pill">${card.failed ? t("Otra vez") : card.attempts ? t("Aprendiendo") : GROUP_LABEL()[card.group]}</span>
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
      ${prefs.debugStudy && card.info ? `<p class="helper debug-line">${t("Puntos")}: ${card.info.score.toFixed(2)}</p>` : ""}
    </div>`;

  const feedback = $("feedback");
  const answer = $("answer");

  /* Muestra la respuesta y los botones para continuar: [valoración, etiqueta, clase] */
  function reveal(ratings, preferred) {
    const now = new Date();
    // Debajo de cada botón, cuándo volvería a salir. La práctica extra no mueve el calendario.
    const when = (rating) => rating === "next" || keepsDate(card, rating) ? ""
      : ` · ${intervalLabel(nextCard(card.rec || {}, rating, now), now)}`;
    answer.innerHTML = `
      ${answerHTML(card)}
      <div class="card-actions">
        ${ratings.map(([rating, label, cls], i) => `
          <button class="button ${cls}" type="button" data-rate="${rating}">
            ${label}
            <small>${i + 1}${when(rating)}</small>
          </button>`).join("")}
      </div>
      ${ratings.length > 1 ? `<p class="helper rating-help">${ratings.some(([rating]) => rating === "again")
        ? t("Otra vez: no la sabías, vuelve a salir en esta sesión. Difícil: te costó. Bien: la recordaste. Fácil: la sabías al instante. Debajo de cada botón ves cuándo volverá a salir.")
        : t("Difícil: te costó. Bien: la recordaste. Fácil: la sabías al instante. Debajo de cada botón ves cuándo volverá a salir.")}</p>` : ""}`;
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

/* Pasa a la siguiente tarjeta. Las falladas vuelven a salir un poco después y
   las que siguen en los pasos cortos (palabras nuevas), al final de la sesión. */
function advance(card) {
  const index = session.queue.indexOf(card);
  if (index >= 0) session.queue.splice(index, 1);

  if (card.requeue) {
    const position = card.requeue === "soon" ? Math.min(3, session.queue.length) : session.queue.length;
    card.requeue = null;
    session.queue.splice(position, 0, card);
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

/* Práctica extra (aún no tocaba) acertada: no cambia el calendario */
const keepsDate = (card, rating) => card.group === "extra" && rating !== "again" && !card.failed;

/* Registra la respuesta: repaso espaciado, historial del día y estado del elemento */
async function gradeCard(card, rating) {
  const correct = rating !== "again";
  const rec = card.rec ??= card.kind === "word"
    ? userWords.get(card.id) || blankUserWord(card.entry.w, card.entry.r)
    : userKanji.get(card.id) || blankUserKanji(card.id);
  withSRS(rec);
  if (card.kind === "word") rec.origin ??= originOf(rec);

  // Historial diario: solo cuenta el primer intento de cada tarjeta
  if (!card.attempts) {
    const day = meta.days[today()] ??= { r: 0, c: 0, n: 0 };
    day.r++;
    if (correct) day.c++;
    if (!rec.studied) day.n++;
  }
  card.attempts = (card.attempts || 0) + 1;

  if (keepsDate(card, rating)) {
    rec.studied = true;
  } else {
    const next = nextCard(rec, rating);
    applyCard(rec, next);
    if (staysInSession(next)) card.requeue = correct ? "later" : "soon";
  }

  if (correct) {
    rec.correctCount++;
    if (rec.lastCorrectDay !== today()) { rec.streakDays++; rec.lastCorrectDay = today(); }
  } else {
    rec.incorrectCount++;
    rec.streakDays = 0;
    card.failed = true;
    card.requeue = "soon";
    session?.missed.set(card.id, card);
  }
  rec.lastReviewed = new Date().toISOString();
  rec.lastSeen = Date.now();

  // Dominada: tres aciertos seguidos en días distintos o un intervalo largo. Un fallo la devuelve a "learning".
  if (card.kind === "word") rec.canReadKanji = correct; else rec.knowsMeaning = correct;
  if (!correct) rec.status = "learning";
  else if (rec.streakDays >= MASTER_STREAK || rec.interval >= STUDY_CONFIG.masteredAtDays) rec.status = "mastered";
  else if (rec.status !== "mastered") rec.status = "learning";

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
   5. AGREGAR PALABRA
   -----------------------------------------
   "Quiero aprenderla": pasa a ser la primera palabra nueva del repaso.
   "Ya la domino": entra con un intervalo largo y sus kanjis cuentan como
   conocidos. Si la palabra está en el banco se usa su entrada; si no, se
   guarda en el diccionario propio del usuario con lo que haya escrito.
   ========================================= */

const isKanaText = (text) => /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u.test(text);
const ORIGIN_LABEL = () => ({ manual: t("a mano"), lectura: t("lectura"), frecuencia: t("lista de frecuencia") });

/* La entrada del banco para lo escrito: por escritura y, si hay varias, por lectura */
function bankMatch(writing, reading) {
  const senses = BANK.byWriting.get(writing) || [];
  const typed = normalizeReading(reading);
  return senses.find((word) => normalizeReading(word.r) === typed) ||
    senses.find((word) => word.alt.some((alt) => normalizeReading(alt) === typed)) ||
    (typed ? null : senses[0]) || null;
}

async function addWord(mode) {
  const say = (text, cls = "") => {
    $("addWordMessage").textContent = text;
    $("addWordMessage").className = `message ${cls}`;
  };
  const writing = normalizeText($("addWriting").value);
  let reading = normalizeText($("addReading").value);
  const meaning = $("addMeaning").value.trim();

  if (!writing || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(writing)) {
    return say(t("Escribe la palabra en japonés."), "incorrect");
  }
  await BANK.loadUpTo("N1").catch(() => {}); // para reconocerla aunque sea de un nivel más alto
  const found = bankMatch(writing, reading);
  if (!reading) reading = found?.r || (isKanaText(writing) ? writing : "");
  if (!reading || !isKanaText(reading)) return say(t("Escribe la lectura en hiragana."), "incorrect");

  const id = found?.id || wordKey(writing, reading);
  if (!found && !words.has(id) || !found && meaning) {
    // Fuera del banco: su significado es el que escribió el usuario (o el del diccionario común)
    const known = meaning ? null : (await lookupDictionary([writing])).get(writing);
    const entry = {
      ...(words.get(id) || {}), id, lemma: writing, reading,
      meanings: meaning ? [meaning] : known?.meanings || words.get(id)?.meanings || [],
      meaningsEs: meaning ? [meaning] : known?.meanings_es || words.get(id)?.meaningsEs || [],
      pos: words.get(id)?.pos || "", source: "manual", updatedAt: Date.now()
    };
    words.set(id, entry);
    await putRecords("words", [entry]);
  }

  const rec = withSRS(userWords.get(id) || blankUserWord(found?.w || writing, found?.r || reading));
  rec.origin = "manual";
  if (meaning && !found) rec.meaning = meaning;
  rec.lastSeen = Date.now();
  if (mode === "mastered") {
    applyCard(rec, masteredCard(STUDY_CONFIG.masteredIntervalDays));
    Object.assign(rec, { status: "mastered", canReadKanji: true, knowsMeaning: true });
  } else if (!rec.studied) {
    rec.status = "learning";
  }
  await saveUserWord(rec);

  $("addWordForm").reset();
  $("addWriting").focus();
  const kana = !hasKanjiChar(rec.lemma);
  say(mode === "mastered"
    ? t("{word} guardada como dominada.", { word: rec.lemma })
    : rec.studied ? t("{word} ya está en tus repasos.", { word: rec.lemma })
    : kana ? t("{word} guardada. Al ir solo en kana no se repasa, pero se usará en tus textos.", { word: rec.lemma })
    : t("{word} agregada: será de las primeras palabras nuevas del repaso.", { word: rec.lemma }), "correct");
  renderAddWord();
  updateCounts();
}

function renderAddWord() {
  const mine = [...userWords.values()].filter((rec) => rec.origin === "manual")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const STATUS = { mastered: t("dominada"), learning: t("por aprender") };
  $("addedWords").innerHTML = mine.length ? mine.slice(0, 100).map((rec) => {
    const entry = wordEntry(rec.id);
    return `<li><strong lang="ja">${escapeHTML(rec.lemma)}</strong>
      <span><span lang="ja">${escapeHTML(rec.reading)}</span>${entry && meaningOf(entry).length ? ` · ${escapeHTML(gloss(entry, 2))}` : ""}
        · ${STATUS[rec.status] || t("por aprender")}</span></li>`;
  }).join("") : `<li><span>${t("Todavía no has agregado ninguna palabra.")}</span></li>`;
}

function bindAddWord() {
  if (window.wanakana?.bind) window.wanakana.bind($("addReading"), { IMEMode: "toHiragana" });
  $("addWordForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addWord(event.submitter?.value === "mastered" ? "mastered" : "learn");
  });
  // Al salir de la escritura, lo que ya sabe el banco se rellena solo
  $("addWriting").addEventListener("change", async () => {
    const writing = normalizeText($("addWriting").value);
    if (!writing) return;
    await BANK.loadUpTo("N1").catch(() => {});
    const found = bankMatch(writing, $("addReading").value);
    if (!found || normalizeText($("addWriting").value) !== writing) return;
    if (!$("addReading").value) $("addReading").value = found.r;
    $("addMeaning").placeholder = gloss(found);
  });
}

/* =========================================
   6. MIGRACIÓN DEL MODELO ANTERIOR
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
